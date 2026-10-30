const mongoose = require('mongoose');

const flatSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    buildingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Building',
      required: true,
      immutable: true,
    },
    wingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Wing', default: null, immutable: true },
    floorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Floor',
      required: true,
      immutable: true,
    },
    flatNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 32 },
    area: { type: Number, required: true, min: 1, max: 1000000 },
    areaUnit: { type: String, enum: ['square_foot', 'square_metre'], required: true },
    propertyType: {
      type: String,
      enum: ['apartment', 'penthouse', 'studio', 'commercial', 'other'],
      required: true,
    },
    occupancyStatus: {
      type: String,
      enum: ['vacant', 'occupied', 'partially_occupied'],
      default: 'vacant',
      required: true,
    },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { timestamps: true, versionKey: false },
);

flatSchema.index({ societyId: 1, buildingId: 1, wingId: 1, flatNumber: 1 }, { unique: true });
flatSchema.index({ societyId: 1, buildingId: 1, floorId: 1 });
flatSchema.index({ societyId: 1, occupancyStatus: 1, status: 1 });

module.exports = mongoose.models.Flat || mongoose.model('Flat', flatSchema);
