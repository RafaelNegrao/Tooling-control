/**
 * Mapa de canais IPC auditados.
 *
 * Cada descritor descreve COMO um canal deve ser registrado no Audit Log:
 *   category      -> tooling | analytics | settings | system
 *   action        -> create | update | delete | import | export | rename | email | clear
 *   entity        -> nome legivel da entidade afetada
 *   entityId      -> identificador do registro afetado
 *   summary       -> texto curto exibido na tabela
 *   before/after  -> snapshots usados para calcular o diff
 *   shouldLog     -> evita gravar quando nada mudou
 */

const { AuditDiff } = require('./audit-logger');

const FIELD_LABELS = {
  pn: 'PN',
  pn_description: 'PN Description',
  supplier: 'Supplier',
  tool_description: 'Tooling Description',
  tooling_life_qty: 'Tooling Life (qty)',
  produced: 'Produced (qty)',
  remaining_tooling_life_pcs: 'Remaining Life (pcs)',
  percent_tooling_life: 'Tooling Life (%)',
  annual_volume_forecast: 'Annual Volume',
  date_annual_volume: 'Annual Volume Date',
  date_remaining_tooling_life: 'Production Date',
  expiration_date: 'Expiration Date',
  status: 'Status',
  step: 'Step',
  responsible: 'Responsible',
  comments: 'Comments',
  analysis_notes: 'Analysis Notes',
  analysis_completed: 'Analysis Completed',
  replacement_tooling_id: 'Replacement Tooling ID',
  last_update: 'Last Update'
};

function labelFor(field) {
  return FIELD_LABELS[field] || field;
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

/** Campos puramente automaticos, que so poluem o diff. */
const NOISE_FIELDS = new Set(['last_update']);

/** Diff calculado uma unica vez por evento (shouldLog roda antes de changes). */
function cachedChanges(context, fields = null) {
  if (!context._changes) {
    context._changes = AuditDiff.compare(context.before, context.after, fields);
  }
  return context._changes;
}

function parseCommentsArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function isSystemChangeComment(comment) {
  return Boolean(comment && comment.system === true);
}

function commentSnapshot(comment) {
  return {
    date: comment?.date || comment?.timestamp || '',
    text: String(comment?.text || '').slice(0, 300),
    system: Boolean(comment?.system)
  };
}

/**
 * O campo `comments` guarda um JSON grande; no log guardamos a contagem e o
 * que mudou de fato — comentarios adicionados, editados e removidos.
 */
function compactCommentsChange(rawBefore, rawAfter) {
  const before = parseCommentsArray(rawBefore);
  const after = parseCommentsArray(rawAfter);

  // O proprio log de alteracoes e gravado como comentario `system`. Ele
  // repete o que ja esta em `changes`, entao nao conta como mudanca.
  const added = after.slice(before.length)
    .filter(comment => !isSystemChangeComment(comment))
    .map(commentSnapshot);
  const removed = before.slice(after.length)
    .filter(comment => !isSystemChangeComment(comment))
    .map(commentSnapshot);

  const edited = [];
  const common = Math.min(before.length, after.length);
  for (let index = 0; index < common; index += 1) {
    const previous = String(before[index]?.text || '');
    const current = String(after[index]?.text || '');
    if (previous !== current && !isSystemChangeComment(after[index])) {
      edited.push({
        index,
        date: after[index]?.date || '',
        from: previous.slice(0, 300),
        to: current.slice(0, 300)
      });
    }
  }

  // Nada alem do log automatico: o campo nao entra no diff.
  if (added.length === 0 && removed.length === 0 && edited.length === 0) {
    return null;
  }

  const humanBefore = before.filter(comment => !isSystemChangeComment(comment)).length;
  const humanAfter = after.filter(comment => !isSystemChangeComment(comment)).length;

  const change = {
    field: 'comments',
    from: `${humanBefore} comment(s)`,
    to: `${humanAfter} comment(s)`,
    added
  };

  if (edited.length > 0) change.edited = edited;
  if (removed.length > 0) change.removed = removed;

  return change;
}

/** Diff de um registro de tooling, sem ruido e com `comments` compactado. */
function toolingChanges(context) {
  if (!context._toolingChanges) {
    context._toolingChanges = AuditDiff.compare(context.before, context.after)
      .filter(change => !NOISE_FIELDS.has(change.field))
      .map(change => (change.field === 'comments'
        ? compactCommentsChange(context.before?.comments, context.after?.comments)
        : change))
      .filter(Boolean);
  }
  return context._toolingChanges;
}

/** Nomes dos arquivos efetivamente gravados, a partir do retorno do handler. */
function attachmentNamesFromResult(result) {
  if (!result || typeof result !== 'object') {
    return [];
  }

  if (Array.isArray(result.results)) {
    return result.results
      .filter(item => item && item.success === true && item.fileName)
      .map(item => String(item.fileName));
  }

  return result.fileName ? [String(result.fileName)] : [];
}

/** Nomes que falharam no upload, para aparecerem no detalhe do log. */
function failedAttachmentNames(result) {
  if (!result || !Array.isArray(result.results)) {
    return [];
  }
  return result.results
    .filter(item => item && item.success !== true && item.fileName)
    .map(item => String(item.fileName));
}

function formatFileNameList(names, limit = 3) {
  if (!Array.isArray(names) || names.length === 0) {
    return '';
  }
  const shown = names.slice(0, limit);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} +${rest} more` : shown.join(', ');
}

function describeAttachmentTarget(supplierName, itemId) {
  return itemId ? `item #${itemId} ("${supplierName}")` : `"${supplierName}"`;
}

function attachmentFileChanges(names) {
  return names.map(name => ({ field: 'file', from: null, to: name }));
}

function describeChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return 'no field changed';
  }
  const labels = changes.slice(0, 3).map(change => labelFor(change.field));
  const rest = changes.length - labels.length;
  return rest > 0 ? `${labels.join(', ')} +${rest}` : labels.join(', ');
}

/**
 * @param {Object} deps
 * @param {Object} deps.toolingDatabase instancia de ToolingDatabase
 * @returns {Object<string, Object>} descritores por canal
 */
function createAuditChannelDescriptors({ toolingDatabase, listSystemAttachments = () => [] }) {
  const addedSystemAttachments = (context) => {
    const before = new Set(context.before?.files || []);
    return (context.after?.files || []).filter(name => !before.has(name));
  };

  const snapshotTooling = async (id) => {
    try {
      return (await toolingDatabase.getToolingById(id)) || null;
    } catch (error) {
      return null;
    }
  };

  const snapshotSetting = async (key) => {
    try {
      const value = await toolingDatabase.getSetting(key);
      return { key, value };
    } catch (error) {
      return { key, value: null };
    }
  };

  const snapshotSupplierMetadata = async (supplierName) => {
    try {
      return (await toolingDatabase.getSupplierMetadata(supplierName)) || null;
    } catch (error) {
      return null;
    }
  };

  const snapshotStepSettings = async (step) => {
    try {
      const all = await toolingDatabase.getStepSettings();
      if (Array.isArray(all)) {
        return all.find(row => String(row.step) === String(step)) || null;
      }
      if (all && typeof all === 'object') {
        return all[step] || null;
      }
      return null;
    } catch (error) {
      return null;
    }
  };

  return {
    // ─────────────── TOOLING ───────────────
    'create-tooling': {
      category: 'tooling',
      action: 'create',
      entity: 'Tooling Item',
      entityId: (ctx) => ctx.result?.id ?? null,
      summary: (ctx) => {
        const data = ctx.args[0] || {};
        return `Created tooling ${data.pn || ''} (${data.supplier || 'no supplier'})`.trim();
      },
      after: async (result) => (result?.id ? snapshotTooling(result.id) : null),
      changes: (ctx) => toolingChanges({ before: {}, after: ctx.after })
    },

    'update-tooling': {
      category: 'tooling',
      action: 'update',
      entity: 'Tooling Item',
      entityId: (ctx) => ctx.args[0],
      before: async (id) => snapshotTooling(id),
      after: async (result, id) => snapshotTooling(id),
      shouldLog: (ctx) => Boolean(ctx.error) || toolingChanges(ctx).length > 0,
      changes: (ctx) => toolingChanges(ctx),
      summary: (ctx) => {
        const pn = ctx.before?.pn || ctx.after?.pn || '';
        return `Updated tooling #${ctx.args[0]}${pn ? ` (${pn})` : ''}: ${describeChanges(toolingChanges(ctx))}`;
      }
    },

    'delete-tooling': {
      category: 'tooling',
      action: 'delete',
      entity: 'Tooling Item',
      entityId: (ctx) => ctx.args[0],
      before: async (id) => snapshotTooling(id),
      summary: (ctx) => {
        const pn = ctx.before?.pn ? ` (${ctx.before.pn})` : '';
        return `Deleted tooling #${ctx.args[0]}${pn}`;
      },
      changes: (ctx) => toolingChanges({ before: ctx.before, after: {} })
    },

    'rename-supplier': {
      category: 'tooling',
      action: 'rename',
      entity: 'Supplier',
      entityId: (ctx) => ctx.args[1],
      summary: (ctx) => `Renamed supplier "${ctx.args[0]}" to "${ctx.args[1]}"`,
      changes: (ctx) => [{ field: 'supplier', from: ctx.args[0], to: ctx.args[1] }]
    },

    'update-supplier-metadata': {
      category: 'tooling',
      action: 'update',
      entity: 'Supplier Metadata',
      entityId: (ctx) => ctx.args[0],
      before: async (supplierName) => snapshotSupplierMetadata(supplierName),
      after: async (result, supplierName) => snapshotSupplierMetadata(supplierName),
      shouldLog: (ctx) => Boolean(ctx.error) || cachedChanges(ctx).length > 0,
      changes: (ctx) => cachedChanges(ctx),
      summary: (ctx) => `Updated metadata of supplier "${ctx.args[0]}": ${describeChanges(cachedChanges(ctx))}`
    },

    // ─────────────── TO-DOS ───────────────
    'add-todo': {
      category: 'tooling',
      action: 'create',
      entity: 'To-do',
      entityId: (ctx) => ctx.args[0],
      summary: (ctx) => `Added to-do on tooling #${ctx.args[0]}: "${String(ctx.args[1] || '').slice(0, 60)}"`
    },

    'update-todo': {
      category: 'tooling',
      action: 'update',
      entity: 'To-do',
      entityId: (ctx) => ctx.args[0],
      summary: (ctx) => {
        const done = ctx.args[2] ? 'completed' : 'pending';
        return `Updated to-do #${ctx.args[0]} (${done})`;
      }
    },

    'delete-todo': {
      category: 'tooling',
      action: 'delete',
      entity: 'To-do',
      entityId: (ctx) => ctx.args[0],
      summary: (ctx) => `Deleted to-do #${ctx.args[0]}`
    },

    // ─────────────── ATTACHMENTS ───────────────
    // O nome do arquivo/imagem vem do retorno do handler, que é quem sabe o que
    // realmente foi gravado em disco (o diálogo de seleção roda no main).
    'upload-attachment': {
      category: 'tooling',
      action: 'create',
      entity: (ctx) => (ctx.args[2]?.kind === 'picture' ? 'Picture' : 'Attachment'),
      entityId: (ctx) => firstDefined(ctx.args[1], ctx.args[0]),
      shouldLog: (ctx) => !ctx.result?.cancelled,
      changes: (ctx) => attachmentFileChanges(attachmentNamesFromResult(ctx.result)),
      extraDetails: (ctx) => {
        const failed = failedAttachmentNames(ctx.result);
        return failed.length > 0 ? { failedFiles: failed } : {};
      },
      summary: (ctx) => {
        const kind = ctx.args[2]?.kind === 'picture' ? 'image' : 'file';
        const names = attachmentNamesFromResult(ctx.result);
        const target = describeAttachmentTarget(ctx.args[0], ctx.args[1]);
        return names.length > 0
          ? `Attached ${formatFileNameList(names)} to ${target}`
          : `Attached ${kind}(s) to ${target}`;
      }
    },

    'upload-attachment-from-paths': {
      category: 'tooling',
      action: 'create',
      entity: (ctx) => (ctx.args[3]?.kind === 'picture' ? 'Picture' : 'Attachment'),
      entityId: (ctx) => firstDefined(ctx.args[2], ctx.args[0]),
      changes: (ctx) => attachmentFileChanges(attachmentNamesFromResult(ctx.result)),
      extraDetails: (ctx) => {
        const failed = failedAttachmentNames(ctx.result);
        return failed.length > 0 ? { failedFiles: failed } : {};
      },
      summary: (ctx) => {
        const kind = ctx.args[3]?.kind === 'picture' ? 'image' : 'file';
        const names = attachmentNamesFromResult(ctx.result);
        const target = describeAttachmentTarget(ctx.args[0], ctx.args[2]);
        return names.length > 0
          ? `Attached ${formatFileNameList(names)} to ${target}`
          : `Attached ${kind}(s) to ${target}`;
      }
    },

    'save-pasted-image': {
      category: 'tooling',
      action: 'create',
      entity: 'Picture',
      entityId: (ctx) => ctx.args[1],
      requestArgs: (ctx) => ({ supplier: ctx.args[0], itemId: ctx.args[1], source: 'clipboard' }),
      changes: (ctx) => attachmentFileChanges(attachmentNamesFromResult(ctx.result)),
      summary: (ctx) => {
        const target = describeAttachmentTarget(ctx.args[0], ctx.args[1]);
        return ctx.result?.fileName
          ? `Pasted image ${ctx.result.fileName} saved on ${target}`
          : `Pasted image saved on ${target}`;
      }
    },

    'share-attachment': {
      category: 'tooling',
      action: 'create',
      entity: (ctx) => (ctx.args[4]?.kind === 'picture' ? 'Picture' : 'Attachment'),
      entityId: (ctx) => ctx.args[1],
      requestArgs: (ctx) => ({
        supplier: ctx.args[0],
        sourceItemId: ctx.args[1],
        files: ctx.args[2],
        targetItemIds: ctx.args[3]
      }),
      changes: (ctx) => {
        const files = Array.isArray(ctx.args[2]) ? ctx.args[2] : [];
        const targets = Array.isArray(ctx.args[3]) ? ctx.args[3] : [];
        return files.map(name => ({ field: 'file', from: null, to: name, sharedWith: targets }));
      },
      summary: (ctx) => {
        const files = Array.isArray(ctx.args[2]) ? ctx.args[2] : [];
        const count = ctx.result?.itemCount || (Array.isArray(ctx.args[3]) ? ctx.args[3].length : 0);
        return `Shared ${formatFileNameList(files)} from item #${ctx.args[1]} with ${count} other tooling(s)`;
      }
    },

    'delete-attachment': {
      category: 'tooling',
      action: 'delete',
      entity: 'Attachment',
      entityId: (ctx) => firstDefined(ctx.args[2], ctx.args[0]),
      changes: (ctx) => [{ field: 'file', from: ctx.args[1], to: null }],
      summary: (ctx) => `Deleted ${ctx.args[1]} from ${describeAttachmentTarget(ctx.args[0], ctx.args[2])}`
    },

    // ─────────────── IMPORT / EXPORT ───────────────
    'import-supplier-data': {
      category: 'tooling',
      action: 'import',
      entity: 'Supplier Data',
      entityId: (ctx) => ctx.args[0],
      shouldLog: (ctx) => !ctx.result?.cancelled,
      summary: (ctx) => `Imported spreadsheet data for supplier "${ctx.args[0]}"`
    },

    'import-new-supplier': {
      category: 'tooling',
      action: 'import',
      entity: 'New Supplier',
      shouldLog: (ctx) => !ctx.result?.cancelled,
      summary: () => 'Imported a new supplier spreadsheet'
    },

    'import-forecast-supplier': {
      category: 'tooling',
      action: 'import',
      entity: 'Forecast (Supplier)',
      shouldLog: (ctx) => !ctx.result?.cancelled,
      summary: () => 'Imported supplier forecast spreadsheet'
    },

    'import-forecast-manager': {
      category: 'tooling',
      action: 'import',
      entity: 'Forecast (Manager)',
      shouldLog: (ctx) => !ctx.result?.cancelled,
      summary: () => 'Imported manager forecast spreadsheet'
    },

    'export-supplier-data': {
      category: 'tooling',
      action: 'export',
      entity: 'Supplier Data',
      entityId: (ctx) => ctx.args[0],
      shouldLog: (ctx) => Boolean(ctx.error) || ctx.result?.success === true,
      summary: (ctx) => `Exported data of supplier "${ctx.args[0]}"`
    },

    'export-empty-template': {
      category: 'tooling',
      action: 'export',
      entity: 'Empty Template',
      shouldLog: (ctx) => Boolean(ctx.error) || ctx.result?.success === true,
      summary: () => 'Exported empty supplier template'
    },

    'export-forecast-supplier': {
      category: 'tooling',
      action: 'export',
      entity: 'Forecast (Supplier)',
      shouldLog: (ctx) => Boolean(ctx.error) || ctx.result?.success === true,
      summary: () => 'Exported supplier forecast spreadsheet'
    },

    'export-forecast-manager': {
      category: 'tooling',
      action: 'export',
      entity: 'Forecast (Manager)',
      shouldLog: (ctx) => Boolean(ctx.error) || ctx.result?.success === true,
      summary: () => 'Exported manager forecast spreadsheet'
    },

    'send-supplier-email': {
      category: 'tooling',
      action: 'email',
      entity: 'Supplier Email',
      entityId: (ctx) => ctx.args[0],
      requestArgs: (ctx) => ({
        supplier: ctx.args[0],
        subject: ctx.args[3],
        to: ctx.args[2],
        message: ctx.args[1]
      }),
      summary: (ctx) => `Sent email to supplier "${ctx.args[0]}"`
    },

    // ─────────────── ANALYTICS ───────────────
    'update-step-settings': {
      category: 'analytics',
      action: 'update',
      entity: 'Step Settings',
      entityId: (ctx) => ctx.args[0],
      before: async (step) => snapshotStepSettings(step),
      after: async (result, step) => snapshotStepSettings(step),
      shouldLog: (ctx) => Boolean(ctx.error) || cachedChanges(ctx).length > 0,
      changes: (ctx) => cachedChanges(ctx),
      summary: (ctx) => `Updated settings of step "${ctx.args[0]}": ${describeChanges(cachedChanges(ctx))}`
    },

    'clear-step-history': {
      category: 'analytics',
      action: 'clear',
      entity: 'Step History',
      entityId: (ctx) => ctx.args[0],
      summary: (ctx) => `Cleared step history of tooling #${ctx.args[0]}`
    },

    'clear-all-step-history': {
      category: 'analytics',
      action: 'clear',
      entity: 'Step History',
      summary: () => 'Cleared the step history of ALL tooling items'
    },

    // ─────────────── SETTINGS ───────────────
    'set-setting': {
      category: 'settings',
      action: 'update',
      entity: 'Global Setting',
      entityId: (ctx) => ctx.args[0],
      before: async (key) => snapshotSetting(key),
      after: async (result, key) => snapshotSetting(key),
      shouldLog: (ctx) => Boolean(ctx.error) || cachedChanges(ctx, ['value']).length > 0,
      changes: (ctx) => cachedChanges(ctx, ['value']),
      summary: (ctx) => `Changed setting "${ctx.args[0]}"`
    },

    // O handler devolve a pasta inteira, então o nome do que entrou vem do diff.
    'add-system-attachment': {
      category: 'settings',
      action: 'create',
      entity: 'System Attachment',
      shouldLog: (ctx) => Boolean(ctx.error) || ctx.result?.success === true,
      before: async () => ({ files: listSystemAttachments() }),
      after: async (result) => ({
        files: Array.isArray(result?.files) ? result.files : listSystemAttachments()
      }),
      changes: (ctx) => attachmentFileChanges(addedSystemAttachments(ctx)),
      entityId: (ctx) => addedSystemAttachments(ctx)[0] || null,
      summary: (ctx) => {
        const added = addedSystemAttachments(ctx);
        return added.length > 0
          ? `Added default email attachment ${formatFileNameList(added)}`
          : 'Added default email attachment';
      }
    },

    'delete-system-attachment': {
      category: 'settings',
      action: 'delete',
      entity: 'System Attachment',
      entityId: (ctx) => ctx.args[0],
      changes: (ctx) => [{ field: 'file', from: ctx.args[0], to: null }],
      summary: (ctx) => `Removed default email attachment ${ctx.args[0]}`
    }
  };
}

module.exports = {
  FIELD_LABELS,
  labelFor,
  createAuditChannelDescriptors
};
