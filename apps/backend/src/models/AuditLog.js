const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      default: null,
      immutable: true,
    },
    action: { type: String, required: true, maxlength: 96, immutable: true },
    targetType: { type: String, maxlength: 96, default: null, immutable: true },
    targetId: { type: String, maxlength: 128, default: null, immutable: true },
    outcome: { type: String, enum: ['success', 'failure'], required: true, immutable: true },
    requestId: { type: String, maxlength: 128, default: null, immutable: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
    occurredAt: { type: Date, required: true, default: Date.now, immutable: true },
  },
  { versionKey: false },
);

for (const operation of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'replaceOne',
  'deleteOne',
  'deleteMany',
]) {
  auditLogSchema.pre(operation, function rejectAuditMutation() {
    throw new Error('Audit logs are append-only');
  });
}

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
