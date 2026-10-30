const mongoose = require('mongoose');

const buildingSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 32 },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { timestamps: true, versionKey: false },
);

buildingSchema.index({ societyId: 1, code: 1 }, { unique: true });

module.exports = mongoose.models.Building || mongoose.model('Building', buildingSchema);
