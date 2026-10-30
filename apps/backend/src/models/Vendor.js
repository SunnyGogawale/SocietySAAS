const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    contactName: { type: String, trim: true, maxlength: 120, default: null },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: null },
    phone: { type: String, trim: true, maxlength: 32, default: null },
    taxIdentifier: { type: String, trim: true, maxlength: 32, default: null },
    payableAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, versionKey: false },
);

vendorSchema.index({ societyId: 1, name: 1 });

module.exports = mongoose.models.Vendor || mongoose.model('Vendor', vendorSchema);
