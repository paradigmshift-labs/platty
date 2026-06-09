import { B } from './circular-b';
export class A {
  b: B;
  constructor() { this.b = new B(); }
}
