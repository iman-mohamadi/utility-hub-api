// schema.js
const { pgTable, varchar, text, timestamp } = require('drizzle-orm/pg-core');

const pastesTable = pgTable('pastes', {
    code: varchar('code', { length: 10 }).primaryKey(),
    content: text('content').notNull(),
    password: text('password'), // Stores hashed password
    deleteToken: varchar('delete_token', { length: 64 }), // Stores secret token for deletion
    createdAt: timestamp('created_at').defaultNow(),
});

module.exports = { pastesTable };