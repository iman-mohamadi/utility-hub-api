require('dotenv').config();

// Create the standard Postgres connection string
const dbUrl = `postgresql://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_DATABASE}`;

/** @type { import("drizzle-kit").Config } */
module.exports = {
    schema: './schema.js',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        url: dbUrl,
        // Add SSL if your database is hosted online (Supabase, Neon, etc.)
        ssl: process.env.DB_HOST !== 'localhost'
    },
};