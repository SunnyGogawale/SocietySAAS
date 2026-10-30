const { sendSuccess } = require('../utils/apiResponse');

function createFinanceController({ financeService }) {
  return {
    async getGateway(request, response) {
      return sendSuccess(
        request,
        response,
        await financeService.getGateway({ society: request.society }),
      );
    },
    async configureGateway(request, response) {
      return sendSuccess(
        request,
        response,
        await financeService.configureGateway({
          society: request.society,
          actor: request.auth.user,
          data: request.validated.body,
          request,
        }),
      );
    },
    async createPayment(request, response) {
      return sendSuccess(
        request,
        response,
        await financeService.createPaymentLink({
          society: request.society,
          membership: request.membership,
          data: request.validated.body,
          request,
        }),
        201,
      );
    },
    async listPayments(request, response) {
      return sendSuccess(request, response, {
        payments: await financeService.listPayments({
          society: request.society,
          membership: request.membership,
        }),
      });
    },
    async requestRefund(request, response) {
      return sendSuccess(
        request,
        response,
        {
          payment: await financeService.requestRefund({
            society: request.society,
            actor: request.auth.user,
            paymentId: request.params.paymentId,
            data: request.validated.body,
            request,
          }),
        },
        201,
      );
    },
    async approveRefund(request, response) {
      return sendSuccess(request, response, {
        payment: await financeService.approveRefund({
          society: request.society,
          actor: request.auth.user,
          paymentId: request.params.paymentId,
          refundId: request.params.refundId,
          request,
        }),
      });
    },
    async listAccounts(request, response) {
      return sendSuccess(request, response, {
        accounts: await financeService.listAccounts({
          society: request.society,
          actor: request.auth.user,
        }),
      });
    },
    async createAccount(request, response) {
      return sendSuccess(
        request,
        response,
        {
          account: await financeService.createAccount({
            society: request.society,
            actor: request.auth.user,
            data: request.validated.body,
            request,
          }),
        },
        201,
      );
    },
    async listVendors(request, response) {
      return sendSuccess(request, response, {
        vendors: await financeService.listVendors({ society: request.society }),
      });
    },
    async createVendor(request, response) {
      return sendSuccess(
        request,
        response,
        {
          vendor: await financeService.createVendor({
            society: request.society,
            actor: request.auth.user,
            data: request.validated.body,
            request,
          }),
        },
        201,
      );
    },
    async listExpenses(request, response) {
      return sendSuccess(request, response, {
        expenses: await financeService.listExpenses({ society: request.society }),
      });
    },
    async createExpense(request, response) {
      return sendSuccess(
        request,
        response,
        {
          expense: await financeService.createExpense({
            society: request.society,
            actor: request.auth.user,
            data: request.validated.body,
            request,
          }),
        },
        201,
      );
    },
    async approveExpense(request, response) {
      return sendSuccess(request, response, {
        expense: await financeService.approveExpense({
          society: request.society,
          actor: request.auth.user,
          expenseId: request.params.expenseId,
          request,
        }),
      });
    },
    async recordVendorPayment(request, response) {
      return sendSuccess(request, response, {
        expense: await financeService.recordVendorPayment({
          society: request.society,
          actor: request.auth.user,
          expenseId: request.params.expenseId,
          data: request.validated.body,
          request,
        }),
      });
    },
    async reverseVendorPayment(request, response) {
      return sendSuccess(request, response, {
        expense: await financeService.reverseVendorPayment({
          society: request.society,
          actor: request.auth.user,
          expenseId: request.params.expenseId,
          vendorPaymentId: request.params.vendorPaymentId,
          reason: request.validated.body.reason,
          request,
        }),
      });
    },
    async reverseExpense(request, response) {
      return sendSuccess(request, response, {
        expense: await financeService.reverseExpense({
          society: request.society,
          actor: request.auth.user,
          expenseId: request.params.expenseId,
          reason: request.validated.body.reason,
          request,
        }),
      });
    },
    async listJournals(request, response) {
      return sendSuccess(request, response, {
        journals: await financeService.listJournals({
          society: request.society,
          from: new Date(request.validated.query.from),
          to: new Date(request.validated.query.to),
        }),
      });
    },
    async getReport(request, response) {
      return sendSuccess(
        request,
        response,
        await financeService.createVendorExpenseReport({
          society: request.society,
          actor: request.auth.user,
          from: new Date(request.validated.query.from),
          to: new Date(request.validated.query.to),
        }),
      );
    },
    async createSettlement(request, response) {
      return sendSuccess(
        request,
        response,
        {
          journalEntry: await financeService.createSettlement({
            society: request.society,
            actor: request.auth.user,
            data: request.validated.body,
            request,
          }),
        },
        201,
      );
    },
    async importStatement(request, response) {
      return sendSuccess(
        request,
        response,
        await financeService.importStatement({
          society: request.society,
          actor: request.auth.user,
          data: request.validated.body,
          request,
        }),
        201,
      );
    },
    async listStatementLines(request, response) {
      return sendSuccess(request, response, {
        lines: await financeService.listStatementLines({
          society: request.society,
          importId: request.validated.query.importId,
        }),
        summary: await financeService.getReconciliationSummary({
          society: request.society,
          importId: request.validated.query.importId,
        }),
      });
    },
    async reconcileLine(request, response) {
      return sendSuccess(request, response, {
        line: await financeService.reconcileLine({
          society: request.society,
          actor: request.auth.user,
          lineId: request.params.lineId,
          journalEntryId: request.validated.body.journalEntryId,
          request,
        }),
      });
    },
  };
}

module.exports = { createFinanceController };
