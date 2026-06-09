import { Injectable } from '@nestjs/common';
import { OrdersRepository } from './orders.repository';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  constructor(private readonly ordersRepository: OrdersRepository) {}

  findAll() {
    return this.ordersRepository.findAll();
  }

  findOne(id: number) {
    return this.ordersRepository.findOne(id);
  }

  create(createOrderDto: CreateOrderDto) {
    return this.ordersRepository.create(createOrderDto);
  }

  protected formatOrder(order: any) {
    return order;
  }
}
