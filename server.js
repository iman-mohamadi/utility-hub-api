require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client } = require('pg');
const { drizzle } = require('drizzle-orm/node-postgres');
const { pgTable, varchar, text, timestamp } = require('drizzle-orm/pg-core');
const { eq, lt } = require('drizzle-orm');

const app = express();
app.use(cors());
app.use(express.json());

// --- 1. DEFINE YOUR DRIZZLE SCHEMA ---
// This tells Drizzle exactly what your Postgres table looks like
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

// Initialize Drizzle with the connected Postgres client
const db = drizzle(client);

// --- 3. HELPER FUNCTION: GENERATE UNIQUE CODE ---
async function generateUniqueCode() {
    let isUnique = false;
    let newCode = "";

    while (!isUnique) {
        newCode = Math.floor(1000 + Math.random() * 9000).toString();

        // READ FROM DB (Drizzle Way): Check if code exists
        // Translates to: SELECT * FROM pastes WHERE code = 'newCode'
        const existingPaste = await db.select().from(pastesTable).where(eq(pastesTable.code, newCode));

        if (existingPaste.length === 0) {
            isUnique = true;
        }
    }
    return newCode;
}

// --- 4. API ROUTES ---

// WRITE TO DATABASE (POST)
app.post('/api/pastes', async (req, res) => {
    try {
        const { content } = req.body;

        if (!content || content.trim() === '') {
            return res.status(400).json({ error: 'متن نمی‌تواند خالی باشد.' }); // Persian error
        }

        const uniqueCode = await generateUniqueCode();

        // WRITE TO DB (Drizzle Way)
        // Translates to: INSERT INTO pastes (code, content) VALUES (...)
        await db.insert(pastesTable).values({
            code: uniqueCode,
            content: content,
        });

        console.log(`✅ Saved new code: ${uniqueCode}`);
        res.status(201).json({ id: uniqueCode, message: 'با موفقیت ذخیره شد!' }); // Persian message
    } catch (error) {
        console.error("Save Error:", error);
        res.status(500).json({ error: 'خطای سرور در ذخیره‌سازی اطلاعات.' });
    }
});

// READ FROM DATABASE (GET)
app.get('/api/pastes/:code', async (req, res) => {
    try {
        const { code } = req.params;

        const result = await db.select().from(pastesTable).where(eq(pastesTable.code, code));
        const paste = result[0];

        // 1. If code doesn't exist at all
        if (!paste) {
            return res.status(404).json({ error: 'کد نامعتبر است یا پیدا نشد.' });
        }

        // 2. Strict Check: If it exists, but is older than 2 days
        const expirationDate = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000));
        if (new Date(paste.createdAt) < expirationDate) {
            return res.status(404).json({ error: 'این کد منقضی شده و دیگر در دسترس نیست.' });
        }

        // 3. Success
        res.json({ content: paste.content, createdAt: paste.createdAt });
    } catch (error) {
        console.error("Read Error:", error);
        res.status(500).json({ error: 'خطای سرور در دریافت اطلاعات.' });
    }
});

// --- BACKGROUND CLEANUP TASK ---
// This function runs automatically every 1 hour to delete codes older than 2 days.

const ONE_HOUR = 60 * 60 * 1000; // in milliseconds
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000; // in milliseconds

setInterval(async () => {
    try {
        // Calculate the exact date and time 2 days ago
        const expirationDate = new Date(Date.now() - TWO_DAYS);

        // DELETE FROM pastes WHERE created_at < expirationDate
        const result = await db.delete(pastesTable).where(lt(pastesTable.createdAt, expirationDate));

        // Optional: Log when it runs (you can remove this later so it doesn't spam your terminal)
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