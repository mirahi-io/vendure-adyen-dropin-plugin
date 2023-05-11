import { LanguageCode, PluginCommonModule, VendurePlugin } from "@vendure/core";
import { schema } from "./adyen-shop-schema";
import { AdyenResolver } from "./adyen.resolver";
import { AdyenService } from "./adyen.service";
import { adyenPaymentHandler } from "./adyen.handler";
import { ADYEN_PLUGIN_INIT_OPTIONS } from "./constant";
import { AdyenController } from "./adyen.controller";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { CustomOrderFields } from "@vendure/core";

@VendurePlugin({
  imports: [PluginCommonModule],
  controllers: [AdyenController],
  providers: [
    AdyenService,
    { provide: ADYEN_PLUGIN_INIT_OPTIONS, useFactory: () => AdyenPlugin.options },
  ],
  shopApiExtensions: {
    schema: schema,
    resolvers: [AdyenResolver],
  },
  configuration: (config) => {
    config.paymentOptions.paymentMethodHandlers.push(adyenPaymentHandler);
    config.customFields.Order.push({
      name: "adyenPluginPaymentMethodCode",
      type: "string",
      label: [
        { languageCode: LanguageCode.en, value: "Payment Method Code" },
        { languageCode: LanguageCode.fr, value: "Code de la méthode de paiement" },
      ],
      nullable: true,
      readonly: true,
    });
    return config;
  },
})
export class AdyenPlugin {
  static options: AdyenPluginOptions = {};
  /**
   * @description
   * Initialize the Adyen payment plugin.
   * @param environment Either 'LIVE' or 'TEST' (default: 'TEST')
   * @param basicAuthCredendials.username (Optional) Username for Basic Auth of the Adyen webhook
   * @param basicAuthCredendials.password (Optional) Password for Basic Auth of the Adyen webhook
   * @param hmacKey (Optional) HMAC key for validating the webhook signature
   * @param paymentMethodCode (Optional) The unique code you use for this payment method (default: "payment-adyen")
   */
  static init(options?: AdyenPluginOptions) {
    if (options) {
      this.options = options;
    }
    return AdyenPlugin;
  }
}

export type AdyenPluginOptions = {
  /** Either 'LIVE' or 'TEST' (default: 'TEST') */
  environment?: "LIVE" | "TEST";
  /** (Optional) Credentials for Basic Auth of the Adyen webhook. */
  basicAuthCredendials?: {
    username: string;
    password: string;
  };
  /** (Optional) HMAC key for validating the webhook signature. */
  hmacKey?: string;
  paymentMethodCode?: string;
};

declare module "@vendure/core" {
  interface CustomOrderFields {
    adyenPluginPaymentMethodCode?: string;
  }
}
