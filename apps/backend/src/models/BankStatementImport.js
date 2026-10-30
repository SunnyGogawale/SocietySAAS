const mongoose = require('mongoose');

const bankStatementImportSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      immutable: true,
    },
    sourceName: { type: String, trim: true, maxlength: 120, required: true },
    fileHash: { type: String, required: true, immutable: true },
    mapping: {
      date: { type: String, required: true, immutable: true },
      description: { type: String, required: true, immutable: true },
      reference: { type: String, required: true, immutable: true },
      debit: { type: String, required: true, immutable: true },
      credit: { type: String, required: true, immutable: true },
      balance: { type: String, required: true, immutable: true },
    },
    status: { type: String, enum: ['imported', 'reviewed', 'reconciled'], default: 'imported' },
    importedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, versionKey: false },
);

bankStatementImportSchema.index({ societyId: 1, fileHash: 1 }, { unique: true });

module.exports =
  mongoose.models.BankStatementImport ||
  mongoose.model('BankStatementImport', bankStatementImportSchema);
