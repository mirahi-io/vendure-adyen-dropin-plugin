import { PaymentMethodHandler, Logger, LanguageCode } from "@vendure/core";
import { AdyenService } from "./adyen.service";
import { EventCode, Success } from "./constant";
import type {
  CreatePaymentResult,
  CreatePaymentErrorResult,
  SettlePaymentResult,
  SettlePaymentErrorResult,
} from "@vendure/core";
import type { NotificationRequestItem } from "@adyen/api-library/lib/src/typings/notification/notificationRequestItem";

export type PaymentMethodHandlerArgs = {
  apiKey?: any;
  redirectUrl?: any;
};
const loggerCtx = "AdyenHandler";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let adyenService: AdyenService;
export const adyenPaymentHandler = new PaymentMethodHandler<PaymentMethodHandlerArgs>({
  code: "payment-adyen",
  description: [
    {
      languageCode: LanguageCode.en,
      value: "Adyen Payment Provider",
    },
  ],
  args: {
    apiKey: {
      type: "string",
      label: [
        { languageCode: LanguageCode.en, value: "API Key" },
        { languageCode: LanguageCode.fr, value: "Clé de l'API" },
      ],
    },
    redirectUrl: {
      type: "string",
      label: [
        { languageCode: LanguageCode.en, value: "Redirect URL" },
        { languageCode: LanguageCode.fr, value: "URL de redirection" },
      ],
      description: [
        { languageCode: LanguageCode.en, value: "Redirect the client to this URL after payment" },
        {
          languageCode: LanguageCode.fr,
          value: "Le client est redirigé vers cet URL quand il a fini de payer",
        },
      ],
    },
  },
  init(injector) {
    adyenService = injector.get(AdyenService);
  },

  /** This is called when the `addPaymentToOrder` mutation is executed.
   * It happens either as a GraphQL mutation (which we block when not admin),
   * or when the `orderService.addPaymentToOrder` method is called by the `AdyenService`.
   */
  createPayment: async (
    ctx,
    order,
    _amount /* Use `metadata.amount` */,
    args,
    _metadata
  ): Promise<CreatePaymentResult | CreatePaymentErrorResult> => {
    const metadata = _metadata as NotificationRequestItem;
    const state = metadata.success === Success.True ? "Authorized" : "Declined";
    // #region Error handling and logging
    // Only Admins and internal calls should be allowed to settle and authorize payments
    if (ctx.apiType !== "admin") {
      throw Error(`CreatePayment is not allowed for apiType '${ctx.apiType}'`);
    } else {
      Logger.info(`Admin API requested "createPayment" for order ${order.code}`, loggerCtx);
    }
    if (metadata.eventCode !== EventCode.Authorisation && metadata.success !== Success.True) {
      throw Error(
        `Cannot create payment for eventCode ${metadata.eventCode} for order ${order.code} because "${metadata?.reason}"`
      );
    }
    if (!metadata.amount.value) {
      throw Error(
        `Metadata for Adyen transaction pspReference=${metadata.pspReference} has no amount provided!`
      );
    }
    Logger.info(`Payment for order ${order.code} created with state '${state}'`, loggerCtx);
    // #endregion
    return {
      amount: metadata.amount.value,
      state,
      transactionId: metadata.pspReference,
      metadata, // Stores all given metadata on a payment
    };
  },

  /** This is called when the `settlePayment` mutation or the `orderService.settlePayment` method are executed */
  settlePayment: async (
    ctx,
    order,
    payment,
    args
  ): Promise<SettlePaymentResult | SettlePaymentErrorResult> => {
    if (ctx.apiType !== "admin") {
      throw Error(`SettlePayment is not allowed for apiType '${ctx.apiType}'`);
    }
    return { success: true };
  },
});
