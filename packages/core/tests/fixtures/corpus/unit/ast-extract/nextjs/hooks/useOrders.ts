import { useState, useEffect } from 'react';
import { fetchOrders } from '../lib/api-client';

export function useOrders() {
  const [orders, setOrders] = useState([]);
  useEffect(() => {
    fetchOrders().then(setOrders);
  }, []);
  return orders;
}
