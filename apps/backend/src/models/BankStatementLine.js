const mongoose = require('mongoose');

const bankStatementLineSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    importId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BankStatementImport',
      required: true,
      immutable: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      immutable: true,
    },
    transactionDate: { type: Date, required: true, immutable: true },
    description: { type: String, required: true, trim: true, maxlength: 240, immutable: true },
    reference: { type: String, trim: true, maxlength: 120, default: null, immutable: true },
    debitMinor: { type: Number, min: 0, required: true, immutable: true },
    creditMinor: { type: Number, min: 0, required: true, immutable: true },
    balanceMinor: { type: Number, required: true, immutable: true },
    matchedJournalEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry',
      default: null,
    },
    matchedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    matchedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

bankStatementLineSchema.index({ societyId: 1, importId: 1, transactionDate: 1 });
bankStatementLineSchema.index({ societyId: 1, accountId: 1, reference: 1, transactionDate: 1 });

module.exports =
  mongoose.models.BankStatementLine || mongoose.model('BankStatementLine', bankStatementLineSchema);
