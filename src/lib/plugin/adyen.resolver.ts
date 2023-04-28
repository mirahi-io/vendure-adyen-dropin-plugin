import { Args, Mutation, ResolveField, Resolver } from "@nestjs/graphql";
import { Allow, Ctx, Logger, Permission, RequestContext } from "@vendure/core";
import { AdyenService } from "./adyen.service";
import type {
  AdyenPaymentIntent,
  AdyenPaymentIntentInput,
  AdyenPaymentIntentError,
  AdyenPaymentIntentResult,
} from "./generated-types/graphql";

@Resolver()
export class AdyenResolver {
  constructor(private adyenService: AdyenService) {}
  @Mutation()
  @Allow(Permission.Owner)
  async createAdyenPaymentIntent(
    @Ctx() ctx: RequestContext,
    @Args("input") input: AdyenPaymentIntentInput
  ): Promise<AdyenPaymentIntentResult> {
    Logger.debug(`AdyenResolver.createAdyenPaymentIntent is called`, "AdyenResolver");
    return this.adyenService.createPaymentIntent(ctx, input);
  }

  @ResolveField()
  @Resolver("AdyenPaymentIntentResult")
  __resolveType(value: AdyenPaymentIntentError | AdyenPaymentIntent): string {
    if ((value as AdyenPaymentIntentError).errorCode) {
      return "AdyenPaymentIntentError";
    } else {
      return "AdyenPaymentIntent";
    }
  }
}
