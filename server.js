require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { pgTable, varchar, text, timestamp } = require('drizzle-orm/pg-core');
const { eq, lt } = require('drizzle-orm');

const app = express();
app.use(cors());

// IMPORTANT UPDATE: Increase the JSON payload limit for large files (e.g., 50mb)
// By default, Express restricts payloads to 100kb, which would break your large JSON formatter.
app.use(express.json({ limit: '50mb' }));

// --- 1. DEFINE YOUR DRIZZLE SCHEMA ---
const pastesTable = pgTable('pastes', {
    code: varchar('code', { length: 10 }).primaryKey(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
});

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
        const { content } = req.body;

        if (!content || content.trim() === '') {
            return res.status(400).json({ error: 'متن نمی‌تواند خالی باشد.' });
        }

        const uniqueCode = await generateUniqueCode();

        await db.insert(pastesTable).values({
            code: uniqueCode,
            content: content,
        });

        console.log(`✅ Saved new code: ${uniqueCode}`);
        res.status(201).json({ id: uniqueCode, message: 'با موفقیت ذخیره شد!' });
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

        const result = await db.select().from(pastesTable).where(eq(pastesTable.code, code));
        const paste = result[0];

        if (!paste) {
            return res.status(404).json({ error: 'کد نامعتبر است یا پیدا نشد.' });
        }

        const expirationDate = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000));
        if (new Date(paste.createdAt) < expirationDate) {
            return res.status(404).json({ error: 'این کد منقضی شده و دیگر در دسترس نیست.' });
        }

        res.json({ content: paste.content, createdAt: paste.createdAt });
    } catch (error) {
        console.error("Read Error:", error);
        res.status(500).json({ error: 'خطای سرور در دریافت اطلاعات.' });
    }
});

// ==========================================
// NEW ROUTE: JSON FORMATTER - PROCESS LARGE FILES
// ==========================================
app.post('/api/format', (req, res) => {
    const { rawJson, action } = req.body;

    if (!rawJson) {
        return res.status(400).json({ error: "کد JSON دریافت نشد." });
    }

    try {
        // Attempt to parse the incoming string
        const parsedData = JSON.parse(rawJson);
        let formattedOutput = "";

        if (action === "beautify") {
            // Format with 2 spaces indentation
            formattedOutput = JSON.stringify(parsedData, null, 2);
        } else if (action === "minify") {
            // Remove all whitespace
            formattedOutput = JSON.stringify(parsedData);
        } else {
            return res.status(400).json({ error: "عملیات نامعتبر است." });
        }

        // Send the formatted string back to the frontend
        return res.json({ result: formattedOutput });

    } catch (error) {
        // If JSON.parse fails, the JSON is invalid
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