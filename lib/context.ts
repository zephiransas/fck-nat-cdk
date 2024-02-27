import { Construct } from 'constructs';

export interface Context {
  readonly account: string
  readonly region: string
}

export const getContext = (scope: Construct): Context => {
  return scope.node.tryGetContext('parameters')
}