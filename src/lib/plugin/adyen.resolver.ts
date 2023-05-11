import { Mutation, ResolveField, Resolver } from "@nestjs/graphql";
import { Allow, Ctx, Logger, Permission, RequestContext } from "@vendure/core";
import { AdyenService } from "./adyen.service";
import type {
  AdyenPaymentIntent,
  AdyenPaymentIntentError,
  AdyenPaymentIntentResult,
} from "./generated-types/graphql";

const loggerCtx = "AdyenResolver";

@Resolver()
export class AdyenResolver {
  constructor(private adyenService: AdyenService) {}
  @Mutation()
  @Allow(Permission.Owner)
  async createAdyenPaymentIntent(@Ctx() ctx: RequestContext): Promise<AdyenPaymentIntentResult> {
    Logger.debug(`AdyenResolver.createAdyenPaymentIntent is called`, loggerCtx);
    return this.adyenService.createPaymentIntent(ctx);
  }

  @ResolveField()
  @Resolver("AdyenPaymentIntentResult")
  __resolveType(value: AdyenPaymentIntentError | AdyenPaymentIntent): string {
    if ((value as AdyenPaymentIntentError).message) {
      return "AdyenPaymentIntentError";
    } else {
      return "AdyenPaymentIntent";
    }
  }
}
