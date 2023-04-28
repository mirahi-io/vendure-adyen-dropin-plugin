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
      name: "paymentMethodCode",
      type: "string",
      label: [
        { languageCode: LanguageCode.en, value: "Payment Method" },
        { languageCode: LanguageCode.fr, value: "Méthode de paiement" },
      ],
      nullable: true,
      readonly: true,
    });
    return config;
  },
})
export class AdyenPlugin {
  static options: AdyenPluginOptions;
  /**
   * @description
   * Initialize the Adyen payment plugin
   * @param vendureHost is needed to pass to Adyen for the webhook
   */
  static init(options: AdyenPluginOptions) {
    this.options = options;
    return AdyenPlugin;
  }
}

export type AdyenPluginOptions = {
  /**
   * The host of your Vendure server, e.g. `'https://my-vendure.io'`.
   * This is used by Adyen to send webhook events to the Vendure server
   */
  vendureHost: string;
  environment?: "LIVE" | "TEST";
  /** (Optional) Credentials for Basic Auth of the Adyen webhook. */
  basicAuthCredendials?: {
    username: string;
    password: string;
  };
  hmacKey?: string;
};

declare module "@vendure/core" {
  interface CustomOrderFields {
    paymentMethodCode?: string;
  }
}
