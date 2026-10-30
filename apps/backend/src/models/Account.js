const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 24 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: {
      type: String,
      enum: ['asset', 'liability', 'equity', 'income', 'expense'],
      required: true,
      immutable: true,
    },
    normalBalance: { type: String, enum: ['debit', 'credit'], required: true, immutable: true },
    systemKey: { type: String, default: null, immutable: true },
    reconciliationEnabled: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, versionKey: false },
);

accountSchema.index({ societyId: 1, code: 1 }, { unique: true });
accountSchema.index(
  { societyId: 1, systemKey: 1 },
  { unique: true, partialFilterExpression: { systemKey: { $type: 'string' } } },
);

module.exports = mongoose.models.Account || mongoose.model('Account', accountSchema);
