const mongoose = require('mongoose');

async function connectDatabase(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  return mongoose.connection;
}

async function disconnectDatabase() {
  await mongoose.disconnect();
}

function getDatabaseState() {
  return mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
}

module.exports = { connectDatabase, disconnectDatabase, getDatabaseState };
