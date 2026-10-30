const mongoose = require('mongoose');

const policySchema = new mongoose.Schema(
  {
    operation: {
      type: String,
      trim: true,
      lowercase: true,
      match: /^[a-z][a-z0-9_]{1,63}$/,
      required: true,
    },
    enabled: { type: Boolean, required: true, default: true },
    requiredApprovals: { type: Number, required: true, min: 1, max: 10, default: 1 },
    amountThresholdMinor: { type: Number, min: 0, default: null },
  },
  { _id: false },
);

const approvalPoliciesSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    policies: { type: [policySchema], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, versionKey: false },
);

approvalPoliciesSchema.index({ societyId: 1 }, { unique: true });

module.exports =
  mongoose.models.ApprovalPolicies || mongoose.model('ApprovalPolicies', approvalPoliciesSchema);
