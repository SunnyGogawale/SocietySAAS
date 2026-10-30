const mongoose = require('mongoose');

const floorSchema = new mongoose.Schema(
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
    floorNumber: { type: Number, required: true, min: -10, max: 250 },
    label: { type: String, trim: true, maxlength: 80, default: '' },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { timestamps: true, versionKey: false },
);

floorSchema.index({ societyId: 1, buildingId: 1, wingId: 1, floorNumber: 1 }, { unique: true });

module.exports = mongoose.models.Floor || mongoose.model('Floor', floorSchema);
