import { gql } from "graphql-tag";

export const schema = gql`
  type AdyenPaymentIntent {
    sessionData: String
    transactionId: String
  }

  type AdyenPaymentIntentError {
    message: String!
  }

  union AdyenPaymentIntentResult = AdyenPaymentIntent | AdyenPaymentIntentError

  extend type Mutation {
    createAdyenPaymentIntent: AdyenPaymentIntentResult!
  }
`;
