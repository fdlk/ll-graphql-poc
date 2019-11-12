const { ApolloServer, gql, PubSub } = require('apollo-server')
const { RESTDataSource } = require('apollo-datasource-rest')
const moment = require('moment')
// const amqp = require('amqplib/callback_api')

const pubsub = new PubSub();
const ORDER_SUBMITTED = 'orderSubmitted'

// const send_message = (queue, message) => {
//   amqp.connect('amqp://localhost', function(error0, connection) {
//     if (error0) { throw error0 }
//     connection.createChannel(function(error1, channel) {
//       if (error1) { throw error1 }
//       channel.assertQueue(queue, { durable: true })
//       channel.sendToQueue(queue, Buffer.from(message))
//       setTimeout(() => connection.close(), 500)
//     })
//   })
// }

class MolgenisAPI extends RESTDataSource {
  constructor() {
    super()
    this.baseURL = 'http://localhost:8081/api/'
  }

  willSendRequest(request) {
    request.headers.set('X-Molgenis-Token', this.context.token);
  }

  async getOrders(since) {
    let params = { num: 10000 }
    if( since ) {
      params = {...params, q: `updateDate=gt=${since}`}
    }
    const response = await this.get('v2/lifelines_order', params)
    return response.items
  }
  async submit(orderNumber){
    const order = await this.get(`v2/lifelines_order/${orderNumber}`)
    const now = moment().utc().toISOString()
    order.state = 'Submitted'
    order.submissionDate = now
    order.updateDate = now
    order.applicationForm = order.applicationForm && order.applicationForm.id
    await this.put(`v1/lifelines_order/${orderNumber}`, order)
    // send_message('order_submitted', JSON.stringify(order))
    pubsub.publish(ORDER_SUBMITTED, { orderSubmitted: order });
    return order
  }
  async updateContents(orderNumber, contents) {
    await this.put(`v1/lifelines_order/${orderNumber}/contents`, contents, {headers: {"Content-Type": "application/json", "Accept": "application/json"}})
    const order = await this.get(`v2/lifelines_order/${orderNumber}`)
    return order
  }
  async createOrder(orderNumber) {
    const now = moment().utc().toISOString()
    const order = {
      orderNumber,
      creationDate: now,
      updateDate: now,
      state: 'Draft'
    }
    await this.post('v1/lifelines_order', order)
    return order
  }
}

// The GraphQL schema in string form
const typeDefs = gql`
  scalar Date
  type Query {
    orders(since: String): [Order]
  }
  type Mutation {
    createOrder(orderNumber: String): Order
    updateContents(orderNumber: String, contents: String): Order
    submit(orderNumber: String): Order
  }
  type Subscription {
    orderSubmitted: Order
  }
  type File {
    id: String,
    filename: String,
    url: String
  }
  enum OrderState {
    Draft,
    Submitted
  }
  type Order {
    orderNumber: String,
    contents: String,
    submissionDate: String,
    creationDate: String,
    updateDate: String,
    projectNumber: String,
    name: String,
    applicationForm: File
    state: OrderState
  }
`

const resolvers = {
  Query: {
    orders: async (_source, { since }, { dataSources: {molgenis} }) => molgenis.getOrders(since)
  },
  Mutation: {
    updateContents: async(_source, { orderNumber, contents }, {dataSources: {molgenis}}) => molgenis.updateContents(orderNumber, contents),
    createOrder: async(_source, { orderNumber }, {dataSources: {molgenis}}) => molgenis.createOrder(orderNumber),
    submit: async(_source, { orderNumber }, {dataSources: {molgenis}}) => molgenis.submit(orderNumber)
  },
  Subscription: {
    orderSubmitted: {      // Additional event labels can be passed to asyncIterator creation      
      subscribe: () => pubsub.asyncIterator([ORDER_SUBMITTED]),    
    },
  }
};

// The ApolloServer constructor requires two parameters: your schema
// definition and your set of resolvers.
const server = new ApolloServer({ 
  typeDefs,
  resolvers,
  dataSources: () => {
    return {
      molgenis: new MolgenisAPI()
    }
  },
  context: ({ req, connection }) => {
    // console.log(req.headers)
    return {
      token: 'cd37c663aa99caa4c648bdcdf480a882',
    }
  }})

// The `listen` method launches a web server.
server.listen().then(({ url, subscriptionsUrl }) => {
  console.log(`🚀 Server ready at ${url}`);
  console.log(`🚀 Subscriptions ready at ${subscriptionsUrl}`);
});