require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt'); // NEW: For hashing passwords
const crypto = require('crypto'); // NEW: For generating secure delete tokens
const { Client } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { pgTable, varchar, text, timestamp } = require('drizzle-orm/pg-core');
const { eq, lt } = require('drizzle-orm');

const { pastesTable } = require('./schema');

const app = express();
app.use(cors());

// Increase the JSON payload limit for large files (e.g., 50mb)
app.use(express.json({ limit: '50mb' }));


// --- 2. CONNECT TO POSTGRESQL ---
const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
});

client.connect()
    .then(() => console.log('✅ Connected to PostgreSQL Successfully!'))
    .catch((err) => console.error('❌ Database Connection Error:', err));

const db = drizzle(client);

// --- 3. HELPER FUNCTION: GENERATE UNIQUE CODE ---
async function generateUniqueCode() {
    let isUnique = false;
    let newCode = "";

    while (!isUnique) {
        newCode = Math.floor(1000 + Math.random() * 9000).toString();
        const existingPaste = await db.select().from(pastesTable).where(eq(pastesTable.code, newCode));

        if (existingPaste.length === 0) {
            isUnique = true;
        }
    }
    return newCode;
}

// --- 4. API ROUTES ---

// ==========================================
// ROUTE: COPY/PASTE - WRITE TO DATABASE (POST)
// ==========================================
app.post('/api/pastes', async (req, res) => {
    try {
        const { content, password } = req.body;

        if (!content || content.trim() === '') {
            return res.status(400).json({ error: 'متن نمی‌تواند خالی باشد.' });
        }

        const uniqueCode = await generateUniqueCode();
        const deleteToken = crypto.randomUUID(); // Generate unique token for deletion

        let hashedPassword = null;
        if (password && password.trim() !== '') {
            // Hash the password with a salt round of 10
            hashedPassword = await bcrypt.hash(password.trim(), 10);
        }

        await db.insert(pastesTable).values({
            code: uniqueCode,
            content: content,
            password: hashedPassword,
            deleteToken: deleteToken
        });

        console.log(`✅ Saved new code: ${uniqueCode} ${hashedPassword ? '(Password Protected)' : ''}`);

        // Return the id AND the deleteToken back to the client
        res.status(201).json({
            id: uniqueCode,
            deleteToken: deleteToken,
            message: 'با موفقیت ذخیره شد!'
        });
    } catch (error) {
        console.error("Save Error:", error);
        res.status(500).json({ error: 'خطای سرور در ذخیره‌سازی اطلاعات.' });
    }
});

// ==========================================
// ROUTE: COPY/PASTE - READ FROM DATABASE (GET)
// ==========================================
app.get('/api/pastes/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const passwordAttempt = req.headers['x-paste-password'];

        const result = await db.select().from(pastesTable).where(eq(pastesTable.code, code));
        const paste = result[0];

        if (!paste) {
            return res.status(404).json({ error: 'کد نامعتبر است یا پیدا نشد.' });
        }

        const expirationDate = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000));
        if (new Date(paste.createdAt) < expirationDate) {
            return res.status(404).json({ error: 'این کد منقضی شده و دیگر در دسترس نیست.' });
        }

        // --- NEW: Password Verification Logic ---
        if (paste.password) {
            if (!passwordAttempt) {
                // If the paste has a password but none was provided, return 401
                return res.status(401).json({ error: 'رمز عبور مورد نیاز است', requirePassword: true });
            }

            // Compare provided password with hashed password
            const isMatch = await bcrypt.compare(passwordAttempt, paste.password);
            if (!isMatch) {
                return res.status(401).json({ error: 'رمز عبور اشتباه است', requirePassword: true });
            }
        }

        res.json({ content: paste.content, createdAt: paste.createdAt });
    } catch (error) {
        console.error("Read Error:", error);
        res.status(500).json({ error: 'خطای سرور در دریافت اطلاعات.' });
    }
});

// ==========================================
// NEW ROUTE: DELETE PASTE
// ==========================================
app.delete('/api/pastes/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const tokenAttempt = req.headers['x-delete-token'];

        if (!tokenAttempt) {
            return res.status(401).json({ error: 'دسترسی غیرمجاز. توکن حذف ارائه نشده است.' });
        }

        const result = await db.select().from(pastesTable).where(eq(pastesTable.code, code));
        const paste = result[0];

        if (!paste) {
            return res.status(404).json({ error: 'کد نامعتبر است.' });
        }

        // Verify the delete token matches what is stored in the database
        if (paste.deleteToken !== tokenAttempt) {
            return res.status(403).json({ error: 'شما اجازه حذف این متن را ندارید.' });
        }

        // Token matches, delete the paste
        await db.delete(pastesTable).where(eq(pastesTable.code, code));
        console.log(`🗑️ Deleted code: ${code}`);

        res.json({ success: true, message: 'متن با موفقیت حذف شد.' });

    } catch (error) {
        console.error("Delete Error:", error);
        res.status(500).json({ error: 'خطای سرور در حذف اطلاعات.' });
    }
});


// ==========================================
// ROUTE: JSON FORMATTER - PROCESS LARGE FILES
// ==========================================
app.post('/api/format', (req, res) => {
    const { rawJson, action } = req.body;

    if (!rawJson) {
        return res.status(400).json({ error: "کد JSON دریافت نشد." });
    }

    try {
        const parsedData = JSON.parse(rawJson);
        let formattedOutput = "";

        if (action === "beautify") {
            formattedOutput = JSON.stringify(parsedData, null, 2);
        } else if (action === "minify") {
            formattedOutput = JSON.stringify(parsedData);
        } else {
            return res.status(400).json({ error: "عملیات نامعتبر است." });
        }

        return res.json({ result: formattedOutput });

    } catch (error) {
        console.error("JSON Parse Error:", error);
        return res.status(400).json({ error: "ساختار JSON نامعتبر است." });
    }
});

// --- BACKGROUND CLEANUP TASK ---
const ONE_HOUR = 60 * 60 * 1000;
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

setInterval(async () => {
    try {
        const expirationDate = new Date(Date.now() - TWO_DAYS);
        const result = await db.delete(pastesTable).where(lt(pastesTable.createdAt, expirationDate));
        console.log(`🧹 Background Check: Cleaned up expired codes.`);
    } catch (error) {
        console.error('❌ Background Cleanup Error:', error);
    }
}, ONE_HOUR);

// --- 5. START SERVER ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Backend is running on http://localhost:${PORT}`);
});