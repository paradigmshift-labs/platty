class Base {
  validate() { return true; }
}
class Child extends Base {
  fn() { return super.validate(); }
}
