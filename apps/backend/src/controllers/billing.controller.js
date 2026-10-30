const { sendSuccess } = require('../utils/apiResponse');

function createBillingController({ billingService, financeService }) {
  return {
    async previewRun(request, response) {
      return sendSuccess(
        request,
        response,
        await billingService.createRecurringRun({
          society: request.society,
          actor: request.auth.user,
          data: request.validated.body,
          request,
        }),
        201,
      );
    },
    async listRuns(request, response) {
      return sendSuccess(request, response, {
        runs: await billingService.listRuns({ society: request.society }),
      });
    },
    async transitionRun(request, response) {
      return sendSuccess(request, response, {
        run: await billingService.updateRunStatus({
          society: request.society,
          actor: request.auth.user,
          runId: request.params.runId,
          action: request.params.action,
          request,
        }),
      });
    },
    async createAdHoc(request, response) {
      return sendSuccess(
        request,
        response,
        {
          bill: await billingService.createStandaloneBill({
            society: request.society,
            actor: request.auth.user,
            data: request.validated.body,
            request,
            source: 'ad_hoc',
          }),
        },
        201,
      );
    },
    async createOpeningBalance(request, response) {
      return sendSuccess(
        request,
        response,
        {
          bill: await billingService.createStandaloneBill({
            society: request.society,
            actor: request.auth.user,
            data: request.validated.body,
            request,
            source: 'opening_balance',
          }),
        },
        201,
      );
    },
    async importOpeningBalances(request, response) {
      return sendSuccess(
        request,
        response,
        await billingService.importOpeningBalances({
          society: request.society,
          actor: request.auth.user,
          data: request.validated.body,
          request,
        }),
        201,
      );
    },
    async listBills(request, response) {
      return sendSuccess(
        request,
        response,
        await billingService.listBills({
          society: request.society,
          membership: request.membership,
          query: request.validated.query,
        }),
      );
    },
    async getBill(request, response) {
      return sendSuccess(
        request,
        response,
        await billingService.getBill({
          society: request.society,
          membership: request.membership,
          billId: request.params.billId,
        }),
      );
    },
    async transitionBill(request, response) {
      return sendSuccess(request, response, {
        bill: await billingService.updateBillStatus({
          society: request.society,
          actor: request.auth.user,
          billId: request.params.billId,
          action: request.params.action,
          request,
        }),
      });
    },
    async cancelBill(request, response) {
      return sendSuccess(
        request,
        response,
        await billingService.cancelBill({
          society: request.society,
          actor: request.auth.user,
          billId: request.params.billId,
          reason: request.validated.body.reason,
          request,
        }),
      );
    },
    async reviseBill(request, response) {
      return sendSuccess(
        request,
        response,
        {
          bill: await billingService.createRevision({
            society: request.society,
            actor: request.auth.user,
            billId: request.params.billId,
            data: request.validated.body,
            request,
          }),
        },
        201,
      );
    },
    async createAdjustment(request, response) {
      return sendSuccess(
        request,
        response,
        {
          adjustment: await billingService.createCreditNote({
            society: request.society,
            actor: request.auth.user,
            billId: request.params.billId,
            data: request.validated.body,
            request,
          }),
        },
        201,
      );
    },
    async transitionAdjustment(request, response) {
      return sendSuccess(request, response, {
        adjustment: await billingService.updateCreditNote({
          society: request.society,
          actor: request.auth.user,
          noteId: request.params.adjustmentId,
          action: request.params.action,
          request,
        }),
      });
    },
    async recordReceipt(request, response) {
      return sendSuccess(
        request,
        response,
        {
          receipt: await financeService.recordManualReceipt({
            society: request.society,
            actor: request.auth.user,
            billingService,
            data: request.validated.body,
            request,
          }),
        },
        201,
      );
    },
    async getAgeing(request, response) {
      return sendSuccess(
        request,
        response,
        await billingService.getAgeingReport({
          society: request.society,
          membership: request.membership,
        }),
      );
    },
    async issueReminders(request, response) {
      return sendSuccess(
        request,
        response,
        await billingService.issueDueReminders({
          society: request.society,
          actor: request.auth.user,
          daysAhead: request.validated.body.daysAhead,
          request,
        }),
      );
    },
    async assessLateFees(request, response) {
      return sendSuccess(
        request,
        response,
        await billingService.assessMonthlyLateFees({
          society: request.society,
          actor: request.auth.user,
          request,
        }),
      );
    },
    async getReminders(request, response) {
      return sendSuccess(request, response, {
        reminders: await billingService.getReminders({
          society: request.society,
          membership: request.membership,
        }),
      });
    },
    async markReminderRead(request, response) {
      return sendSuccess(request, response, {
        reminder: await billingService.markReminderRead({
          society: request.society,
          membership: request.membership,
          reminderId: request.params.reminderId,
        }),
      });
    },
    async downloadPdf(request, response) {
      const { buffer, filename } = await billingService.getBillPdf({
        society: request.society,
        membership: request.membership,
        billId: request.params.billId,
        actor: request.auth.user,
        request,
      });
      response
        .set('content-type', 'application/pdf')
        .set('content-disposition', `attachment; filename="${filename}"`)
        .set('content-length', String(buffer.length))
        .status(200)
        .send(buffer);
    },
  };
}

module.exports = { createBillingController };
