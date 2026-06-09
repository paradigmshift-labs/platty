interface Props { params: { id: string } }

export default function OrderDetailPage({ params }: Props) {
  return <div>Order {params.id}</div>;
}
