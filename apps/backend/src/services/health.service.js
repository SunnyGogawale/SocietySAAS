const { getDatabaseState } = require('../db/connection');

function createHealthService(databaseState = getDatabaseState) {
  function getHealth() {
    return {
      status: 'ok',
      service: 'backend',
      database: databaseState(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  function getReadiness() {
    const database = databaseState();
    return {
      ready: database === 'connected',
      service: 'backend',
      database,
    };
  }

  return { getHealth, getReadiness };
}

module.exports = { createHealthService };
