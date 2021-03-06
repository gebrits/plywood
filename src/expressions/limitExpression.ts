/*
 * Copyright 2016-2016 Imply Data, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { r, ExpressionJS, ExpressionValue, Expression, ChainableExpression } from './baseExpression';
import { SQLDialect } from '../dialect/baseDialect';
import { PlywoodValue, Dataset } from '../datatypes/index';
import { ApplyExpression } from './applyExpression';

export class LimitExpression extends ChainableExpression {
  static op = "Limit";
  static fromJS(parameters: ExpressionJS): LimitExpression {
    let value = ChainableExpression.jsToValue(parameters);
    value.value = parameters.value || (parameters as any).limit;
    return new LimitExpression(value);
  }

  public value: int;

  constructor(parameters: ExpressionValue = {}) {
    super(parameters, dummyObject);
    this._ensureOp("limit");
    this._checkOperandTypes('DATASET');

    let value = parameters.value;
    if (value == null) value = Infinity;
    if (value < 0) throw new Error(`limit value can not be negative (is ${value})`);
    this.value = value;

    this.type = 'DATASET';
  }

  public valueOf(): ExpressionValue {
    let value = super.valueOf();
    value.value = this.value;
    return value;
  }

  public toJS(): ExpressionJS {
    let js = super.toJS();
    js.value = this.value;
    return js;
  }

  public equals(other: LimitExpression): boolean {
    return super.equals(other) &&
      this.value === other.value;
  }

  protected _toStringParameters(indent?: int): string[] {
    return [String(this.value)];
  }

  protected _calcChainableHelper(operandValue: any): PlywoodValue {
    return operandValue ? (operandValue as Dataset).limit(this.value) : null;
  }

  protected _getSQLChainableHelper(dialect: SQLDialect, operandSQL: string): string {
    return `LIMIT ${this.value}`;
  }

  protected specialSimplify(): Expression {
    const { operand, value } = this;

    // X.limit(Infinity)
    if (!isFinite(value)) return operand;

    // X.limit(a).limit(b)
    if (operand instanceof LimitExpression) {
      const { operand: x, value: a } = operand;
      return x.limit(Math.min(a, value));
    }

    // X.apply(...).limit(...)
    if (operand instanceof ApplyExpression) {
      return this.swapWithOperand();
    }

    return this;
  }
}

Expression.register(LimitExpression);
