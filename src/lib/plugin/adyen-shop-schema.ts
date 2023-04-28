import { gql } from "graphql-tag";

export const schema = gql`
  type AdyenPaymentIntent {
    sessionData: String
    transactionId: String
  }
  type AdyenPaymentIntentError implements ErrorResult {
    errorCode: ErrorCode!
    message: String!
  }
  union AdyenPaymentIntentResult = AdyenPaymentIntent | AdyenPaymentIntentError
  input AdyenPaymentIntentInput {
    paymentMethodCode: String!
  }
  input AdyenPaymentMethodsInput {
    paymentMethodCode: String!
  }
  extend type Mutation {
    createAdyenPaymentIntent(input: AdyenPaymentIntentInput!): AdyenPaymentIntentResult!
  }
`;
