require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    ssl: false // Explicitly disabled SSL
});

async function updateDatabase() {
    try {
        await client.connect();
        console.log('✅ Connected to database');

        await client.query('ALTER TABLE pastes ADD COLUMN IF NOT EXISTS password TEXT;');
        console.log('✅ Added password column');

        await client.query('ALTER TABLE pastes ADD COLUMN IF NOT EXISTS delete_token VARCHAR(64);');
        console.log('✅ Added delete_token column');

        console.log('🎉 Database is fully updated! You can start your server now.');
    } catch (error) {
        console.error('❌ Migration Error:', error.message);
    } finally {
        await client.end();
        process.exit(0);
    }
}

updateDatabase();