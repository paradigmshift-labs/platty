import { Injectable } from '@nestjs/common';

@Injectable()
export class OrdersRepository {
  private orders: any[] = [];

  findAll() {
    return this.orders;
  }

  findOne(id: number) {
    return this.orders.find(o => o.id === id);
  }

  create(dto: any) {
    const order = { id: Date.now(), ...dto };
    this.orders.push(order);
    return order;
  }
}
