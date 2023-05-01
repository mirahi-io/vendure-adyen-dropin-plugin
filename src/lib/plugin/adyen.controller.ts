// See: https://github.com/vendure-ecommerce/vendure/blob/master/packages/payments-plugin/src/mollie/mollie.controller.ts
import { Body, Controller, Headers, Post, Inject } from "@nestjs/common";
import { Logger } from "@vendure/core";
import { AdyenService } from "./adyen.service";
import HmacValidator from "@adyen/api-library/lib/src/utils/hmacValidator";
import { ADYEN_PLUGIN_INIT_OPTIONS } from "./constant";
import type {
  NotificationRequestItem,
  Notification as WebhookBody,
} from "@adyen/api-library/lib/src/typings/notification/models";
import type { AdyenPluginOptions } from "./adyen.plugin";

const loggerCtx = "AdyenWebhook";

@Controller("webhooks")
export class AdyenController {
  private hmacValidator: HmacValidator;
  constructor(
    private adyenService: AdyenService,
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-ignore
    @Inject(ADYEN_PLUGIN_INIT_OPTIONS) private options: AdyenPluginOptions
  ) {
    this.hmacValidator = new HmacValidator();
  }

  @Post("adyen/standard") // Handles Adyen's standard webhooks: https://docs.adyen.com/api-explorer/Webhooks/1/post/AUTHORISATION#request
  async webhook(
    @Headers("authorization") basicAuthHeader: unknown,
    @Body() body: WebhookBody
  ): Promise<string | void> {
    const notificationRequestItem = body?.notificationItems[0].NotificationRequestItem;
    const { basicAuthCredendials, hmacKey, environment } = this.options;

    if (environment === "LIVE" && !hmacKey) {
      Logger.error(
        `HMAC key is required for LIVE environment for security reasons. Ignoring webhook.`,
        loggerCtx
      );
      return;
    }

    if (basicAuthCredendials && !this.isBasicAuthed(basicAuthHeader)) return;
    if (hmacKey && this.hmacIsValid(notificationRequestItem, hmacKey) === false) return;

    try {
      await this.adyenService.handleAdyenStatusUpdate(notificationRequestItem);
    } catch (error: any) {
      Logger.error(`Payment was unsuccessful.`, loggerCtx, error?.message);
      return "[accepted]";
    }
    return "[accepted]";
  }

  private isBasicAuthed(authHeader: unknown) {
    if (typeof authHeader !== "string") {
      Logger.warn(`[DENIED] No Basic authentication was found in HTTP headers`, loggerCtx);
      return false;
    }
    const [authType, base64] = authHeader.split(" ");
    if (authType !== "Basic") {
      Logger.warn(`[DENIED] Authentication type isn't "Basic"`, loggerCtx);
      return false;
    }
    const [user, password] = Buffer.from(base64, "base64").toString("ascii").split(":");
    if (
      user === this.options?.basicAuthCredendials?.username &&
      password === this.options?.basicAuthCredendials?.password
    ) {
      Logger.info(`Webhook is authed`, loggerCtx);
      return true;
    }

    Logger.warn(`[DENIED] Basic auth credentials are not valid`, loggerCtx);
    return false;
  }

  private hmacIsValid(notificationRequestItem: NotificationRequestItem, hmac: string) {
    try {
      const isValid = this.hmacValidator.validateHMAC(notificationRequestItem, hmac);
      isValid
        ? Logger.info("HMAC signature: OK", loggerCtx)
        : Logger.warn("HMAC signature is invalid!", loggerCtx);
      return isValid;
    } catch (error: any) {
      Logger.error(`Webhook HMAC validation caused an error!`, loggerCtx, error?.message);
      return false;
    }
    // HmacValidator doc: https://docs.adyen.com/development-resources/webhooks/verify-hmac-signatures?utm_source=ca_test&tab=codeBlockhmac_validation_kRbv3_JS_4
  }
}
