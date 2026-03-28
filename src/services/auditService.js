const pool = require("../db");
const { randomUUID } = require("crypto");
const AppError = require("../utils/AppError");

const auditAction = async ({ action, resource, entity_id = [], performed_by, connection }) => {
    if (!Array.isArray(entity_id)) {
        throw new AppError("entity id must be provided as an array");
    }
    
    let self_conn = false;
    if (!connection) {
        connection = await pool.getConnection();
        self_conn = true;
        await connection.beginTransaction();
    }

    try {
        const [account_rows] = await connection.query(`
            SELECT 1 FROM accounts
            WHERE account_id = ?
        `, [performed_by]);

        if (account_rows.length === 0) {
            throw new AppError("Could not proceed with the action.", 400);
        }

        const values = [];
        entity_id.forEach(eid => {
            values.push(action, resource, eid, performed_by);
        });
        
        await connection.query(`
            INSERT INTO audit_logs(action, resource, entity_id, performed_by) 
            VALUES ${entity_id.map(eid => "(?, ?, ?, ?)").join(", ")}
        `, values);

        if (self_conn) await connection.commit();
    } catch (e) {
        if (self_conn) await connection.rollback();
        throw e;
    } finally {
        if (self_conn) connection.release();
    }
};

const getAuditLogs = async ({ resource = [], limit, page, connection }) => {
    limit = !isNaN(limit) ? Number(limit) : 100;
    limit = Math.min(limit, 100);
    page = Math.max(1, !isNaN(page) ? Number(page) : 1);
    const offset = (page - 1) * limit;

    let self_conn = false;
    if (!connection) {
        connection = await pool.getConnection();
        self_conn = true;
    }
    try {
        const [rows] = await connection.query(`
            SELECT a.id, a.action, a.resource, a.entity_id, a.performed_by, DATE_FORMAT(a.performed_at, '%Y-%m-%d %H:%i:%s') AS performed_at
            FROM audit_logs AS a
            ${resource.length ? `WHERE resource IN (${resource.map(() => '?').join(',')})` : ''}
            ORDER BY performed_at DESC
            LIMIT ?
            OFFSET ?
        `, [...resource, limit, offset]);

        if (self_conn) connection.release();

        return { data: rows};
    } catch (e) {
        if (self_conn) await connection.rollback();
        throw e;
    } finally {
        if (self_conn) connection.release();
    }
};

module.exports = {
  auditAction,
  getAuditLogs
};