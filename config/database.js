/**
 * Database Configuration
 * MySQL Connection Pool
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: 'localhost',
  user: 'cit_user',
  password:'Muhammad12590@#$%*()',
  database:'cit_platform',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Test connection
pool.getConnection()
  .then(connection => {
    console.log('✅ Database connected successfully');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
  });

// Helper functions for database operations
const db = {
  // Execute a query
  query: async (sql, params) => {
    try {
      const [results] = await pool.execute(sql, params);
      return results;
    } catch (error) {
      console.error('Database query error:', error);
      throw error;
    }
  },

  // Get a single row
  getOne: async (sql, params) => {
    try {
      const [results] = await pool.execute(sql, params);
      return results[0] || null;
    } catch (error) {
      console.error('Database getOne error:', error);
      throw error;
    }
  },

  // Get multiple rows
  getMany: async (sql, params) => {
    try {
      const [results] = await pool.execute(sql, params);
      return results;
    } catch (error) {
      console.error('Database getMany error:', error);
      throw error;
    }
  },

  // Insert and return insertId
  insert: async (sql, params) => {
    try {
      const [result] = await pool.execute(sql, params);
      return result.insertId;
    } catch (error) {
      console.error('Database insert error:', error);
      throw error;
    }
  },

  // Update and return affected rows
  update: async (sql, params) => {
    try {
      const [result] = await pool.execute(sql, params);
      return result.affectedRows;
    } catch (error) {
      console.error('Database update error:', error);
      throw error;
    }
  },

  // Delete and return affected rows
  delete: async (sql, params) => {
    try {
      const [result] = await pool.execute(sql, params);
      return result.affectedRows;
    } catch (error) {
      console.error('Database delete error:', error);
      throw error;
    }
  },

  // Transaction support
  transaction: async (callback) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  // Get connection pool for raw queries
  pool
};

module.exports = db;