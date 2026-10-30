const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    flatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Flat', required: true, immutable: true },
    membershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocietyMembership',
      default: null,
      immutable: true,
    },
    occupancyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Occupancy',
      default: null,
      immutable: true,
    },
    registrationNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 32,
    },
    vehicleType: { type: String, enum: ['car', 'motorcycle', 'bicycle', 'other'], required: true },
    make: { type: String, trim: true, maxlength: 80, default: '' },
    model: { type: String, trim: true, maxlength: 80, default: '' },
    color: { type: String, trim: true, maxlength: 40, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true, versionKey: false },
);

vehicleSchema.index(
  { societyId: 1, registrationNumber: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);
vehicleSchema.index({ societyId: 1, flatId: 1, status: 1 });

module.exports = mongoose.models.Vehicle || mongoose.model('Vehicle', vehicleSchema);
