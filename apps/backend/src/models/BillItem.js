const mongoose = require('mongoose');

const billItemSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MaintenanceBill',
      required: true,
      immutable: true,
    },
    code: { type: String, required: true, trim: true, maxlength: 64, immutable: true },
    description: { type: String, required: true, trim: true, maxlength: 200, immutable: true },
    category: {
      type: String,
      enum: ['maintenance', 'ad_hoc', 'discount', 'opening_balance'],
      required: true,
      immutable: true,
    },
    calculation: {
      type: String,
      enum: ['fixed_per_home', 'per_area', 'manual', 'opening_balance'],
      required: true,
      immutable: true,
    },
    rateMinor: { type: Number, required: true, min: 0, immutable: true },
    quantity: { type: Number, required: true, min: 0, immutable: true },
    amountMinor: { type: Number, required: true, min: 0, immutable: true },
    discount: { type: Boolean, default: false, immutable: true },
    reason: { type: String, trim: true, maxlength: 500, default: null, immutable: true },
  },
  { timestamps: true, versionKey: false },
);

billItemSchema.index({ societyId: 1, billId: 1 });

module.exports = mongoose.models.BillItem || mongoose.model('BillItem', billItemSchema);
