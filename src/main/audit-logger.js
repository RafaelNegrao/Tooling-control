/**
 * Sistema de auditoria (Audit Log) da aplicacao.
 *
 * Estrutura orientada a objetos:
 *   SystemUser          -> identifica o usuario do Windows que executa a acao
 *   AuditSanitizer      -> normaliza/limpa payloads antes de virarem JSON
 *   AuditDiff           -> compara estado anterior x posterior de um registro
 *   AuditEntry          -> value object de um evento de auditoria
 *   AuditLogger         -> persistencia, consulta e manutencao da tabela audit_log
 *   IpcAuditInterceptor -> intercepta canais IPC e grava logs automaticamente
 */

const os = require('os');

const AUDIT_TABLE = 'audit_log';
const MAX_STRING_LENGTH = 600;
const MAX_ARRAY_ITEMS = 60;
const MAX_DEPTH = 8;

// Chaves cujo conteudo e volumoso ou sensivel: guardamos so o tamanho.
const SENSITIVE_KEY_PATTERN = /(base64|password|senha|token|secret|buffer|blob|dataurl|comment)/i;

/**
 * Resolve os dados do usuario do sistema operacional (Windows).
 */
class SystemUser {
  constructor() {
    this.refresh();
  }

  refresh() {
    let info = {};
    try {
      info = os.userInfo() || {};
    } catch (error) {
      info = {};
    }

    this.username = String(
      info.username || process.env.USERNAME || process.env.USER || 'UNKNOWN'
    ).trim();
    this.domain = String(process.env.USERDOMAIN || process.env.COMPUTERNAME || '').trim();
    this.machine = (() => {
      try {
        return os.hostname();
      } catch (error) {
        return String(process.env.COMPUTERNAME || '').trim();
      }
    })();
    this.platform = process.platform;

    return this;
  }

  /** Nome amigavel: "DOMINIO\\usuario" quando houver dominio. */
  get displayName() {
    return this.domain ? `${this.domain}\\${this.username}` : this.username;
  }

  toJSON() {
    return {
      username: this.username,
      domain: this.domain,
      machine: this.machine,
      platform: this.platform,
      displayName: this.displayName
    };
  }

  static current() {
    if (!SystemUser._instance) {
      SystemUser._instance = new SystemUser();
    }
    return SystemUser._instance;
  }
}

/**
 * Deixa qualquer valor seguro/compacto para ser gravado como JSON.
 */
class AuditSanitizer {
  static sanitize(value, depth = 0, key = '') {
    if (value === null || value === undefined) {
      return null;
    }

    if (depth > MAX_DEPTH) {
      return '[max depth reached]';
    }

    const type = typeof value;

    if (type === 'string') {
      if (SENSITIVE_KEY_PATTERN.test(key) && value.length > 120) {
        return `[omitted ${value.length} chars]`;
      }
      return value.length > MAX_STRING_LENGTH
        ? `${value.slice(0, MAX_STRING_LENGTH)} [+${value.length - MAX_STRING_LENGTH} chars]`
        : value;
    }

    if (type === 'number' || type === 'boolean') {
      return value;
    }

    if (type === 'bigint') {
      return value.toString();
    }

    if (type === 'function' || type === 'symbol') {
      return `[${type}]`;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (value instanceof Error) {
      return { name: value.name, message: value.message };
    }

    if (Buffer.isBuffer(value)) {
      return `[buffer ${value.length} bytes]`;
    }

    if (Array.isArray(value)) {
      const sliced = value
        .slice(0, MAX_ARRAY_ITEMS)
        .map(item => AuditSanitizer.sanitize(item, depth + 1, key));
      if (value.length > MAX_ARRAY_ITEMS) {
        sliced.push(`[+${value.length - MAX_ARRAY_ITEMS} items]`);
      }
      return sliced;
    }

    if (type === 'object') {
      const output = {};
      for (const [entryKey, entryValue] of Object.entries(value)) {
        output[entryKey] = AuditSanitizer.sanitize(entryValue, depth + 1, entryKey);
      }
      return output;
    }

    return String(value);
  }

  static stringify(value) {
    try {
      return JSON.stringify(AuditSanitizer.sanitize(value), null, 2);
    } catch (error) {
      return JSON.stringify({ error: 'Failed to serialize audit details', message: error.message });
    }
  }
}

/**
 * Compara dois snapshots e devolve apenas os campos alterados.
 */
class AuditDiff {
  static normalize(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    return String(value).trim();
  }

  static isEqual(a, b) {
    const left = AuditDiff.normalize(a);
    const right = AuditDiff.normalize(b);

    if (left === right) {
      return true;
    }

    if (left === null || right === null) {
      return false;
    }

    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber === rightNumber;
    }

    return false;
  }

  /**
   * @param {Object} before estado anterior
   * @param {Object} after estado posterior
   * @param {Array<string>} [fields] restringe a comparacao a estes campos
   * @returns {Array<{field:string, from:*, to:*}>}
   */
  static compare(before, after, fields = null) {
    const source = before && typeof before === 'object' ? before : {};
    const target = after && typeof after === 'object' ? after : {};
    const keys = Array.isArray(fields) && fields.length > 0
      ? fields
      : Array.from(new Set([...Object.keys(source), ...Object.keys(target)]));

    const changes = [];
    keys.forEach((field) => {
      const from = source[field];
      const to = target[field];
      if (!AuditDiff.isEqual(from, to)) {
        changes.push({
          field,
          from: AuditSanitizer.sanitize(from === undefined ? null : from, 0, field),
          to: AuditSanitizer.sanitize(to === undefined ? null : to, 0, field)
        });
      }
    });

    return changes;
  }
}

/**
 * Value object de um evento de auditoria.
 */
class AuditEntry {
  constructor(data = {}, user = SystemUser.current()) {
    const now = new Date();

    this.timestamp = data.timestamp || now.toISOString();
    this.timestampLocal = data.timestampLocal || AuditEntry.formatLocal(now);
    this.windowsUser = data.windowsUser || user.username;
    this.userDomain = data.userDomain || user.domain;
    this.machine = data.machine || user.machine;
    this.appVersion = data.appVersion || '';
    this.category = AuditEntry.normalizeToken(data.category, 'system');
    this.action = AuditEntry.normalizeToken(data.action, 'update');
    this.entity = String(data.entity || '').trim() || 'Unknown';
    this.entityId = data.entityId === null || data.entityId === undefined
      ? ''
      : String(data.entityId).trim();
    this.summary = String(data.summary || '').trim() || `${this.action} ${this.entity}`;
    this.status = data.status === 'error' ? 'error' : 'success';
    this.channel = String(data.channel || '').trim();
    this.origin = String(data.origin || 'main').trim();
    this.durationMs = Number.isFinite(Number(data.durationMs)) ? Math.round(Number(data.durationMs)) : null;
    this.changesCount = Number.isFinite(Number(data.changesCount)) ? Number(data.changesCount) : 0;
    this.details = data.details && typeof data.details === 'object' ? data.details : {};
  }

  static normalizeToken(value, fallback) {
    const token = String(value || '').trim().toLowerCase();
    return token || fallback;
  }

  static formatLocal(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  toRow() {
    return [
      this.timestamp,
      this.timestampLocal,
      this.windowsUser,
      this.userDomain,
      this.machine,
      this.appVersion,
      this.category,
      this.action,
      this.entity,
      this.entityId,
      this.summary,
      this.status,
      this.channel,
      this.origin,
      this.durationMs,
      this.changesCount,
      AuditSanitizer.stringify(this.details)
    ];
  }
}

/**
 * Persistencia e consulta dos eventos de auditoria.
 */
class AuditLogger {
  /**
   * @param {Object} options
   * @param {Object} options.executor objeto com run/get/all (ex.: ToolingDatabase)
   * @param {string} [options.appVersion]
   * @param {number} [options.retentionLimit] quantidade maxima de registros mantidos
   */
  constructor(options = {}) {
    this.executor = options.executor || null;
    this.appVersion = options.appVersion || '';
    this.retentionLimit = Number.isFinite(Number(options.retentionLimit))
      ? Number(options.retentionLimit)
      : 20000;
    this.user = SystemUser.current();
    this.enabled = options.enabled !== false;
    this.tableReady = false;
    this.tablePromise = null;
    this.writeQueue = Promise.resolve();
    this.retentionCounter = 0;
    this.listeners = new Set();
  }

  setExecutor(executor) {
    this.executor = executor;
    this.tableReady = false;
    this.tablePromise = null;
    return this;
  }

  onRecord(listener) {
    if (typeof listener === 'function') {
      this.listeners.add(listener);
    }
    return () => this.listeners.delete(listener);
  }

  notify(entry) {
    this.listeners.forEach((listener) => {
      try {
        listener(entry);
      } catch (error) {
        console.error('[AuditLogger] listener error:', error);
      }
    });
  }

  async ensureTable() {
    if (this.tableReady) {
      return;
    }
    if (!this.tablePromise) {
      this.tablePromise = (async () => {
        await this.executor.run(`CREATE TABLE IF NOT EXISTS ${AUDIT_TABLE} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          timestamp_local TEXT,
          windows_user TEXT,
          user_domain TEXT,
          machine TEXT,
          app_version TEXT,
          category TEXT,
          action TEXT,
          entity TEXT,
          entity_id TEXT,
          summary TEXT,
          status TEXT,
          channel TEXT,
          origin TEXT,
          duration_ms INTEGER,
          changes_count INTEGER,
          details TEXT
        )`);

        await this.executor.run(
          `CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON ${AUDIT_TABLE}(timestamp DESC)`
        );
        await this.executor.run(
          `CREATE INDEX IF NOT EXISTS idx_audit_category ON ${AUDIT_TABLE}(category)`
        );
        await this.executor.run(
          `CREATE INDEX IF NOT EXISTS idx_audit_user ON ${AUDIT_TABLE}(windows_user)`
        );

        this.tableReady = true;
      })().catch((error) => {
        this.tablePromise = null;
        throw error;
      });
    }

    await this.tablePromise;
  }

  /**
   * Grava um evento. Nunca lanca — auditoria nao pode quebrar a operacao de negocio.
   * @returns {Promise<AuditEntry|null>}
   */
  record(data = {}) {
    if (!this.enabled || !this.executor) {
      return Promise.resolve(null);
    }

    const entry = new AuditEntry({ appVersion: this.appVersion, ...data }, this.user);

    this.writeQueue = this.writeQueue
      .then(async () => {
        await this.ensureTable();
        await this.executor.run(
          `INSERT INTO ${AUDIT_TABLE} (
            timestamp, timestamp_local, windows_user, user_domain, machine, app_version,
            category, action, entity, entity_id, summary, status, channel, origin,
            duration_ms, changes_count, details
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          entry.toRow()
        );
        await this.enforceRetention();
        this.notify(entry);
      })
      .catch((error) => {
        console.error('[AuditLogger] Failed to record entry:', error);
      });

    return this.writeQueue.then(() => entry);
  }

  async enforceRetention() {
    if (!this.retentionLimit || this.retentionLimit <= 0) {
      return;
    }
    this.retentionCounter += 1;
    if (this.retentionCounter % 200 !== 1) {
      return;
    }
    await this.executor.run(
      `DELETE FROM ${AUDIT_TABLE} WHERE id NOT IN (
         SELECT id FROM ${AUDIT_TABLE} ORDER BY id DESC LIMIT ?
       )`,
      [this.retentionLimit]
    );
  }

  buildWhere(filters = {}) {
    const clauses = [];
    const params = [];

    if (filters.category && filters.category !== 'all') {
      clauses.push('category = ?');
      params.push(String(filters.category).toLowerCase());
    }

    if (filters.action && filters.action !== 'all') {
      clauses.push('action = ?');
      params.push(String(filters.action).toLowerCase());
    }

    if (filters.user && filters.user !== 'all') {
      clauses.push('windows_user = ?');
      params.push(String(filters.user));
    }

    if (filters.status && filters.status !== 'all') {
      clauses.push('status = ?');
      params.push(String(filters.status));
    }

    if (filters.dateFrom) {
      clauses.push('timestamp >= ?');
      params.push(`${filters.dateFrom}T00:00:00.000Z`);
    }

    if (filters.dateTo) {
      clauses.push('timestamp <= ?');
      params.push(`${filters.dateTo}T23:59:59.999Z`);
    }

    const search = String(filters.search || '').trim();
    if (search) {
      clauses.push('(summary LIKE ? OR entity LIKE ? OR entity_id LIKE ? OR windows_user LIKE ? OR details LIKE ? OR channel LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like, like, like);
    }

    return {
      sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
      params
    };
  }

  async query(filters = {}) {
    await this.ensureTable();

    const page = Math.max(1, parseInt(filters.page, 10) || 1);
    const pageSize = Math.min(500, Math.max(10, parseInt(filters.pageSize, 10) || 50));
    const offset = (page - 1) * pageSize;
    const where = this.buildWhere(filters);

    const totalRow = await this.executor.get(
      `SELECT COUNT(*) AS total FROM ${AUDIT_TABLE} ${where.sql}`,
      where.params
    );
    const total = totalRow && totalRow.total ? totalRow.total : 0;

    const rows = await this.executor.all(
      `SELECT id, timestamp, timestamp_local, windows_user, user_domain, machine,
              category, action, entity, entity_id, summary, status, channel, origin,
              duration_ms, changes_count
         FROM ${AUDIT_TABLE}
         ${where.sql}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`,
      [...where.params, pageSize, offset]
    );

    return {
      success: true,
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    };
  }

  async getById(id) {
    await this.ensureTable();
    const row = await this.executor.get(`SELECT * FROM ${AUDIT_TABLE} WHERE id = ?`, [id]);
    if (!row) {
      return { success: false, error: 'Log entry not found.' };
    }

    let details = {};
    try {
      details = row.details ? JSON.parse(row.details) : {};
    } catch (error) {
      details = { raw: row.details, parseError: error.message };
    }

    return { success: true, entry: { ...row, details } };
  }

  async getFilterOptions() {
    await this.ensureTable();
    const [users, categories, actions] = await Promise.all([
      this.executor.all(
        `SELECT DISTINCT windows_user AS value FROM ${AUDIT_TABLE} WHERE windows_user <> '' ORDER BY windows_user`
      ),
      this.executor.all(
        `SELECT DISTINCT category AS value FROM ${AUDIT_TABLE} WHERE category <> '' ORDER BY category`
      ),
      this.executor.all(
        `SELECT DISTINCT action AS value FROM ${AUDIT_TABLE} WHERE action <> '' ORDER BY action`
      )
    ]);

    return {
      success: true,
      users: users.map(r => r.value),
      categories: categories.map(r => r.value),
      actions: actions.map(r => r.value)
    };
  }

  async getStats() {
    await this.ensureTable();
    const totals = await this.executor.get(`SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
        COUNT(DISTINCT windows_user) AS users,
        MIN(timestamp) AS firstAt,
        MAX(timestamp) AS lastAt
      FROM ${AUDIT_TABLE}`);

    const byCategory = await this.executor.all(
      `SELECT category, COUNT(*) AS total FROM ${AUDIT_TABLE} GROUP BY category ORDER BY total DESC`
    );

    return { success: true, ...(totals || {}), byCategory };
  }

  /** Exporta os registros que atendem ao filtro (sem paginacao) com o JSON completo. */
  async exportEntries(filters = {}) {
    await this.ensureTable();
    const where = this.buildWhere(filters);
    const rows = await this.executor.all(
      `SELECT * FROM ${AUDIT_TABLE} ${where.sql} ORDER BY id DESC LIMIT 10000`,
      where.params
    );

    return rows.map((row) => {
      let details = {};
      try {
        details = row.details ? JSON.parse(row.details) : {};
      } catch (error) {
        details = { raw: row.details };
      }
      return { ...row, details };
    });
  }

  async clear(filters = {}) {
    await this.ensureTable();
    const where = this.buildWhere(filters);
    const result = await this.executor.run(`DELETE FROM ${AUDIT_TABLE} ${where.sql}`, where.params);
    return { success: true, removed: result.changes || 0 };
  }
}

/**
 * Intercepta canais IPC e registra automaticamente as alteracoes.
 *
 * Uso:
 *   new IpcAuditInterceptor(logger, descriptors).install(ipcMain);
 * A instalacao deve ocorrer ANTES do registro dos handlers.
 */
class IpcAuditInterceptor {
  /**
   * @param {AuditLogger} logger
   * @param {Object<string, Object>} descriptors mapa canal -> descritor
   */
  constructor(logger, descriptors = {}) {
    this.logger = logger;
    this.descriptors = descriptors;
    this.installed = false;
  }

  register(channel, descriptor) {
    this.descriptors[channel] = descriptor;
    return this;
  }

  install(ipcMain) {
    if (this.installed) {
      return this;
    }
    this.installed = true;

    const originalHandle = ipcMain.handle.bind(ipcMain);

    ipcMain.handle = (channel, listener) => {
      const descriptor = this.descriptors[channel];
      if (!descriptor) {
        return originalHandle(channel, listener);
      }
      return originalHandle(channel, this.wrap(channel, descriptor, listener));
    };

    return this;
  }

  wrap(channel, descriptor, listener) {
    const logger = this.logger;

    return async function auditedHandler(event, ...args) {
      const startedAt = Date.now();
      let before = null;

      if (typeof descriptor.before === 'function') {
        try {
          before = await descriptor.before(...args);
        } catch (error) {
          before = { auditError: error.message };
        }
      }

      let result;
      let failure = null;

      try {
        result = await listener(event, ...args);
      } catch (error) {
        failure = error;
      }

      let after = null;
      if (!failure && typeof descriptor.after === 'function') {
        try {
          after = await descriptor.after(result, ...args);
        } catch (error) {
          after = { auditError: error.message };
        }
      }

      const context = {
        channel,
        args,
        before,
        after,
        result,
        error: failure,
        durationMs: Date.now() - startedAt
      };

      try {
        if (typeof descriptor.shouldLog !== 'function' || descriptor.shouldLog(context)) {
          const changes = typeof descriptor.changes === 'function'
            ? (descriptor.changes(context) || [])
            : AuditDiff.compare(before, after);

          const failedByResult = !failure && result && result.success === false;

          logger.record({
            category: descriptor.category || 'system',
            action: typeof descriptor.action === 'function' ? descriptor.action(context) : descriptor.action,
            entity: typeof descriptor.entity === 'function' ? descriptor.entity(context) : descriptor.entity,
            entityId: typeof descriptor.entityId === 'function' ? descriptor.entityId(context) : null,
            summary: typeof descriptor.summary === 'function'
              ? descriptor.summary(context)
              : (descriptor.summary || channel),
            status: failure || failedByResult ? 'error' : 'success',
            channel,
            origin: 'ipc',
            durationMs: context.durationMs,
            changesCount: changes.length,
            details: {
              request: AuditSanitizer.sanitize(
                typeof descriptor.requestArgs === 'function' ? descriptor.requestArgs(context) : args
              ),
              before: before ? AuditSanitizer.sanitize(before) : null,
              after: after ? AuditSanitizer.sanitize(after) : null,
              changes,
              result: AuditSanitizer.sanitize(result === undefined ? null : result),
              error: failure ? { message: failure.message, stack: failure.stack } : null,
              ...(typeof descriptor.extraDetails === 'function' ? descriptor.extraDetails(context) : {})
            }
          });
        }
      } catch (auditError) {
        console.error(`[AuditLogger] Failed to audit channel "${channel}":`, auditError);
      }

      if (failure) {
        throw failure;
      }

      return result;
    };
  }
}

module.exports = {
  AUDIT_TABLE,
  SystemUser,
  AuditSanitizer,
  AuditDiff,
  AuditEntry,
  AuditLogger,
  IpcAuditInterceptor
};
