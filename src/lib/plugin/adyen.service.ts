import { Inject, Injectable } from "@nestjs/common";
import {
  ActiveOrderService,
  ChannelService,
  EntityHydrator,
  ErrorResult,
  LanguageCode,
  Logger,
  Order,
  OrderService,
  OrderStateTransitionError,
  PaymentMethod,
  PaymentMethodService,
  RequestContext,
  OrderLine,
  CustomOrderFields,
} from "@vendure/core";
import type { OrderState } from "@vendure/core";
import { Client, CheckoutAPI } from "@adyen/api-library";
import { ADYEN_PLUGIN_INIT_OPTIONS, EventCode } from "./constant";
import type { AdyenPaymentIntentResult } from "./generated-types/graphql";
import type { AdyenPluginOptions } from "./adyen.plugin";
import type { PaymentMethodHandlerArgs } from "./adyen.handler";
import type { NotificationRequestItem } from "@adyen/api-library/lib/src/typings/notification/models";
import type { Address as AdyenAddress } from "@adyen/api-library/lib/src/typings/checkout/address";
import type { OrderAddress } from "@vendure/common/lib/generated-types";

const loggerCtx = "AdyenService";
@Injectable()
export class AdyenService {
  constructor(
    private paymentMethodService: PaymentMethodService,
    private activeOrderService: ActiveOrderService,
    private orderService: OrderService,
    private channelService: ChannelService,
    private entityHydrator: EntityHydrator,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-ignore
    @Inject(ADYEN_PLUGIN_INIT_OPTIONS) private options: AdyenPluginOptions
  ) {
    Logger.verbose("Service instantiated", loggerCtx);
  }

  async createPaymentIntent(ctx: RequestContext): Promise<AdyenPaymentIntentResult> {
    const paymentMethodCode = this.options?.paymentMethodCode ?? "payment-adyen";
    const [order, paymentMethod] = await Promise.all([
      this.activeOrderService.getActiveOrder(ctx, undefined),
      this.getPaymentMethod(ctx, paymentMethodCode),
    ]);
    if (!paymentMethod) {
      Logger.debug(`No paymentMethod found!`, loggerCtx);
      return { message: `No paymentMethod found!` };
    }
    /* Getting arguments from payment method (set in Admin UI) and options (set in `vendure-config.ts`) */
    const apiKey = this.getPaymentMethodArg(paymentMethod, "apiKey");
    const redirectUrl = this.trimEnd(this.getPaymentMethodArg(paymentMethod, "redirectUrl"), "/");
    const environment = this.options?.environment ?? "TEST";

    // #region Error handling & Logging
    if (!order || !order.code || !order.active) {
      Logger.debug("No active order for this session!", loggerCtx);
      return { message: "No active order for this session!" };
    }
    if (!order.total || order.total <= 0) {
      Logger.debug("The total for the order caused an error!", loggerCtx);
      return { message: "The total for the order caused an error!" };
    }
    if (!apiKey || !redirectUrl) {
      Logger.warn(
        `CreatePaymentIntent failed, because no apiKey or redirect is configured for ${paymentMethod.code}`,
        loggerCtx
      );
      return {
        message: `Paymentmethod ${paymentMethod.code} has no apiKey or redirectUrl configured`,
      };
    }
    Logger.info(
      `Payment intent is valid for order ${order.code} (${order.total / 100} ${
        order.currencyCode
      }). Now creating session...`,
      loggerCtx
    );
    // #endregion
    /* Storing this to create a payment later */
    const adyenPluginPaymentMethodCode =
      paymentMethodCode as CustomOrderFields["adyenPluginPaymentMethodCode"];
    await this.orderService.updateCustomFields(ctx, order.id, {
      adyenPluginPaymentMethodCode,
    });
    /* Adding some relevant information from context to the order object */
    await this.entityHydrator.hydrate(ctx, order, {
      relations: ["customer", "surcharges", "lines.productVariant", "shippingLines.shippingMethod"],
    });
    if (!order.customer) {
      Logger.debug("The order doesn't have a customer!", loggerCtx);
      return { message: "The order doesn't have a customer!" };
    }
    const { firstName, lastName, emailAddress, phoneNumber } = order.customer;
    if (!firstName || !lastName || !emailAddress) {
      Logger.debug(
        `Some required customer data is missing. firstName: ${firstName}, lastName: ${lastName}, email: ${emailAddress}`,
        loggerCtx
      );
      return {
        message: `Some required customer data is missing. firstName: ${firstName}, lastName: ${lastName}, email: ${emailAddress}`,
      };
    }
    /** !! Minimum length: 3 characters !! Your reference to uniquely identify this shopper, for example user ID or account ID. */
    const shopperReference = ctx.session?.user?.id
      ? `vendure${String(ctx.session.user.id)}`
      : undefined;

    /* Creating Adyen client */
    const client = new Client({ apiKey, environment });
    const checkout = new CheckoutAPI(client);
    /* Getting session */
    const checkoutSession = await checkout
      .sessions({
        // The channel token on Vendure needs to match the merchantAccount name on Adyen (or the other way around)
        merchantAccount: ctx.channel.token,
        amount: { currency: order.currencyCode, value: order.total },
        reference:
          order.code /* The value you pass here will be later called `merchantReference`. This must be unique. */,
        returnUrl: `${redirectUrl}?orderCode=${order.code}`,
        lineItems: this.toAdyenOrderLines(order?.lines),
        shopperEmail: emailAddress,
        shopperName: { firstName, lastName },
        telephoneNumber: phoneNumber,
        billingAddress: this.toAdyenBillingAddress(order.billingAddress),
        shopperReference,
        /* This can't be `true` if there's no `shopperReference` */
        storePaymentMethod: !!shopperReference,
        // store: "", /* (Opt.) The ecommerce or point-of-sale store that is processing the payment. */
        // countryCode: order.currencyCode /* The two-character ISO-3166-1 alpha-2 country code. You might want to use a third-party lib to parse this one (https://www.npmjs.com/package/iso-3166-1-alpha-2) */,
        // allowedPaymentMethods: ["bcmc","visa"], /* You can restrict payment methods here. */
        // dateOfBirth: "2000-12-12", /* (Opt.) The shopper's date of birth.  Format [ISO-8601](https://www.w3.org/TR/NOTE-datetime): YYYY-MM-DD */
        // metadata: { "key": "value" }, /* (Opt.) Metadata consists of entries, each of which includes a key and a value. Limits: * Maximum 20 key-value pairs per request. * Maximum 20 characters per key. * Maximum 80 characters per value. */
        // shopperIP: "123.12.23.34" /* (Opt.) Recommended for risk checks */,
      })
      .catch((err) => {
        Logger.error(`Failed to create Adyen session!`, loggerCtx, err?.message);
        return { error: err?.message as string };
      });

    if (!("error" in checkoutSession)) Logger.info(`Sending sessionData to client.`, loggerCtx);
    else {
      Logger.warn(`No sessionData to send to the client!`, loggerCtx);
      return { message: "The total for the order caused an error!" };
    }

    return {
      sessionData: checkoutSession?.sessionData,
      transactionId: checkoutSession?.id,
    };
  }
  /**
   * You get the outcome of each payment asynchronously, in a webhook event with eventCode: AUTHORISATION.
   * For a successful payment, the event contains `success`: `"true"`.
   * For an unsuccessful payment, you get `success`: `"false"`, and the `reason` field has details about why the payment was unsuccessful.
   */
  async handleAdyenStatusUpdate(notificationRequestItem: NotificationRequestItem) {
    const {
      eventCode,
      merchantAccountCode,
      merchantReference: orderCode,
      success,
    } = notificationRequestItem;
    const ctx = await this.createContext(merchantAccountCode);
    const order = await this.orderService.findOneByCode(ctx, orderCode);

    if (!order) {
      Logger.warn(`No Vendure order matches Adyen's 'merchantReference' ${orderCode}`, loggerCtx);
      return;
    }
    Logger.info(
      `Received status update for channel ${merchantAccountCode} for order ${order?.code} (Vendure code)`,
      loggerCtx
    );
    /** This `switch` statement is where you can handle all situations based on the provided `eventCode`
     *  With a simple architecture using only card payments, e.g., you only receive `Authorisation` webhooks.
     */
    Logger.debug(`Webhook eventCode is ${eventCode} and success is ${success}`, loggerCtx);
    switch (eventCode) {
      case EventCode.Authorisation: {
        await this.addPayment(ctx, order, notificationRequestItem);
        return;
      }
      /* Examples */
      /* By default, capture happens automatically, so this eventCode won't be sent a lot.
       * https://docs.adyen.com/online-payments/classic-integrations/modify-payments/capture#automatic-capture
       * */
      // case EventCode.Capture: {
      //   await this.settleExistingPayment(ctx, order, notificationRequestItem.pspReference);
      //   return;
      // }
      // case EventCode.AuthorisationAdjustment: { return }
      /* ... */
    }

    // No other status is handled
    throw Error(
      `Unhandled incoming Adyen eventCode '${eventCode}' for order ${order.code}; pspReference ${notificationRequestItem.pspReference}; success=${success}`
    );
  }

  /**
   * Add payment to order. Can be settled or authorized depending on the payment method.
   */
  async addPayment(
    ctx: RequestContext,
    order: Order,
    notificationRequestItem: NotificationRequestItem
  ) {
    if (!order.customFields.adyenPluginPaymentMethodCode) {
      throw Error(`Order ${order.code} doesn't have an 'adyenPluginPaymentMethodCode'`);
    }
    if (order.state !== "AddingItems" && order.state !== "ArrangingPayment") {
      Logger.info(`Order ${order.code} has status "${order.state}". Skipping...`, loggerCtx);
      return;
    }

    await this.transitionOrderState(ctx, order, "ArrangingPayment");

    const updatedOrder = await this.orderService.addPaymentToOrder(ctx, order.id, {
      method: order.customFields.adyenPluginPaymentMethodCode,
      metadata: notificationRequestItem,
    });

    if (!(updatedOrder instanceof Order)) {
      throw Error(`Error when processing payment for order ${order.code}: ${updatedOrder.message}`);
    }

    const paymentMethodCode = this.options?.paymentMethodCode ?? "payment-adyen";
    const paymentMethod = await this.getPaymentMethod(ctx, paymentMethodCode);
    if (!paymentMethod) {
      Logger.verbose(`No paymentMethod found!`, loggerCtx);
      return;
    }

    if (updatedOrder.state === "PaymentAuthorized") {
      this.settleExistingPayment(ctx, updatedOrder, notificationRequestItem.pspReference);
    }
  }

  async settleExistingPayment(
    ctx: RequestContext,
    order: Order,
    pspReference: string
  ): Promise<void> {
    const payment = order.payments?.find((p) => p.transactionId === pspReference);
    if (!payment) {
      throw Error(
        `Cannot find payment with transactionId ${pspReference} for ${order.code}. Unable to settle this payment!`
      );
    }
    const settlePaymentResult = await this.orderService.settlePayment(ctx, payment.id);

    if ((settlePaymentResult as ErrorResult).message) {
      throw Error(
        `Error settling payment ${payment.id} for order ${order.code}: ${
          (settlePaymentResult as ErrorResult).errorCode
        } - ${(settlePaymentResult as ErrorResult).message}`
      );
    }
    Logger.info(`Settled payment with transactionId ${pspReference} for ${order.code}.`, loggerCtx);
  }

  private trimEnd(str: string | undefined, unwantedEnding: string) {
    if (!str) return undefined;
    return str.endsWith(unwantedEnding) ? str.slice(0, -unwantedEnding.length) : str;
  }

  async transitionOrderState(ctx: RequestContext, order: Order, newState: OrderState) {
    if (order.state !== newState) {
      const transitionToStateResult = await this.orderService.transitionToState(
        ctx,
        order.id,
        newState
      );
      if (transitionToStateResult instanceof OrderStateTransitionError) {
        throw Error(
          `Error transitioning order ${order.code} from ${transitionToStateResult.fromState} to ${transitionToStateResult.toState}: ${transitionToStateResult.message}`
        );
      }
      return transitionToStateResult;
    } else {
      Logger.debug(`Order ${order.code} is already in state '${newState}'. Skipping...`, loggerCtx);
    }
  }

  private toAdyenOrderLines(orderLines: OrderLine[] | undefined) {
    return orderLines?.map(({ id, unitPriceWithTax, quantity }) => ({
      id: id.toString(),
      amountIncludingTax: unitPriceWithTax,
      quantity,
    }));
  }

  private toAdyenBillingAddress(billingAddress: OrderAddress): AdyenAddress | undefined {
    const { streetLine1, streetLine2, city, postalCode, province, countryCode } = billingAddress;
    if (!streetLine1 || !city || !postalCode || !countryCode) return undefined;

    const trim = (str: string | undefined) => (str && str.length > 3000 ? str.slice(0, 2999) : str);
    return {
      /* All address fields are strings with max length 3000. */
      country: countryCode /* The two-character ISO-3166-1 alpha-2 country code. */,
      city: trim(city) as string,
      street: trim(streetLine1) as string,
      houseNumberOrName: trim(streetLine2) || "",
      postalCode: trim(postalCode) as string,
      stateOrProvince: trim(province),
    };
  }

  private async getPaymentMethod(ctx: RequestContext, paymentMethodCode: string) {
    const paymentMethods = await this.paymentMethodService.findAll(ctx);
    return paymentMethods.items.find((pm) => pm.code === paymentMethodCode);
  }

  getPaymentMethodArg(paymentMethod: PaymentMethod, desiredArg: keyof PaymentMethodHandlerArgs) {
    return paymentMethod?.handler.args.find((arg) => arg.name === desiredArg)?.value;
  }

  private async createContext(channelToken: string): Promise<RequestContext> {
    const channel = await this.channelService.getChannelFromToken(channelToken);
    return new RequestContext({
      apiType: "admin",
      isAuthorized: true,
      authorizedAsOwnerOnly: false,
      channel,
      languageCode: LanguageCode.en,
    });
  }
}
