const mongoose = require('mongoose');

const journalLineSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    journalEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry',
      required: true,
      immutable: true,
    },
    lineNumber: { type: Number, required: true, immutable: true },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      immutable: true,
    },
    side: { type: String, enum: ['debit', 'credit'], required: true, immutable: true },
    amountMinor: { type: Number, required: true, min: 1, immutable: true },
    memo: { type: String, trim: true, maxlength: 240, default: null, immutable: true },
  },
  { timestamps: true, versionKey: false },
);

journalLineSchema.index({ societyId: 1, journalEntryId: 1, lineNumber: 1 }, { unique: true });
journalLineSchema.index({ societyId: 1, accountId: 1 });

module.exports = mongoose.models.JournalLine || mongoose.model('JournalLine', journalLineSchema);
