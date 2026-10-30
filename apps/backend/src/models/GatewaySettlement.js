const mongoose = require('mongoose');

const gatewaySettlementSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    reference: { type: String, trim: true, maxlength: 120, required: true, immutable: true },
    amountMinor: { type: Number, min: 1, required: true, immutable: true },
    bankAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      immutable: true,
    },
    settledAt: { type: Date, required: true, immutable: true },
    journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, versionKey: false },
);

gatewaySettlementSchema.index({ societyId: 1, reference: 1 }, { unique: true });

module.exports =
  mongoose.models.GatewaySettlement || mongoose.model('GatewaySettlement', gatewaySettlementSchema);
