const express = require('express');
const cors = require('cors');
const connectDB = require('./src/config/mongo');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Built-in & Third-party Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic Health Check Route
app.get('/', (req, res) => {
    res.status(200).json({
        message: 'Server is running successfully',
        timestamp: new Date().toISOString()
    });
});


// Start Server
app.listen(PORT, () => {
    connectDB();
    console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
