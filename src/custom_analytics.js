import moment from 'moment'
import _ from 'lodash'
import Promise from 'bluebird'

module.exports = ({ bp }) => {

  const graphs = []

  async function increment(name, count = 1, racing = false) {
    if (!_.isString(name)) {
      throw new Error('Invalid name, expected a string')
    }

    if (!_.isNumber(count)) {
      throw new Error('Invalid count increment, expected a valid number')
    }

    const knex = await bp.db.get()

    const today = moment().format('YYYY-MM-DD')
    name = name.toLowerCase().trim()

    if (!name.includes('~')) {
      name += '~'
    }

    const countQuery = (count < 0)
      ? ('count - ' + Math.abs(count))
      : ('count + ' + Math.abs(count))

    const result = await knex('analytics_custom')
    .where('date', today)
    .andWhere('name', name)
    .update('count', knex.raw(countQuery))
    .then()

    if (result == 0 && !racing) {
      await knex('analytics_custom')
      .insert({
        'name': name,
        'date': today,
        'count': count
      })
      .catch(err => {
        return increment(name, count, true)
      })
    }
  }

  async function decrement(name, count = 1) {
    return increment(name, count * -1)
  }

  //{ name, type, description, variables }
  function addGraph(graph) {

    if (!_.includes(['count', 'percent', 'piechart'], graph.type)) {
      throw new Error('Unknown graph of type ' + graph.type)
    }

    graphs.push(graph)
  }

  // FROM = 2017-09-11
  // TO = 2017-09-15
  // YYYY-MM-DD

  const getters = {
    'count': async function(graph, from, to) {
      const knex = await bp.db.get()

      const variable = _.first(graph.variables)

      const rows = await knex('analytics_custom')
      .select(['date', knex.raw('sum(count) as count')])
      .where('date', '>=', from)
      .andWhere('date', '<=', to)
      .andWhere('name', 'LIKE', variable + '~%')
      .groupBy('date')
      .then(rows => {
        return rows.map(row => {
          return Object.assign(row, { count: parseInt(row.count) })
        })
      })

      return Object.assign({}, graph, { results: rows })
    },

    'percent': async function(graph, from, to) {

      const variable1 = _.first(graph.variables)
      const variable2 = _.last(graph.variables)

      const count1 = await getters.count({ variables: [variable1] }, from, to)
      const count2 = await getters.count({ variables: [variable2] }, from, to)

      const allDates = _.uniq(_.map(count1.results, 'date'), _.map(count2.results, 'date'))

      const rows = allDates.map(date => {
        const n1 = _.find(count1, { date: date }) || { count: 0 }
        const n2 = _.find(count2, { date: date }) || { count: 1 }

        let percent = n1.count / n2.count

        if (percent > 1) {
          percent = 1
        }

        return { date: date, percent: percent }
      })
      
      return Object.assign({}, graph, { results: rows })
    },

    'piechart': async function(graph, from, to) {
      const knex = await bp.db.get()

      const variable = _.first(graph.variables)

      const rows = await knex('analytics_custom')
      .select(['name', knex.raw('sum(count) as count')])
      .where('date', '>=', from)
      .andWhere('date', '<=', to)
      .andWhere('name', 'LIKE', variable + '~%')
      .groupBy('name')
      .then(rows => {
        return rows.map(row => {
          const name = _.drop(row.name.split('~')).join('~')

          return Object.assign(row, {
            name: _.isEmpty(name) ? 'unknown' : name,
            count: parseInt(row.count)
          })
        })
      })

      return Object.assign({}, graph, { results: rows })
    }
  }

  async function getAll(from, to) {
    return Promise.map(graphs, graph => getters[graph.type](graph, from, to))
  }

  return { increment, decrement, addGraph, getAll }
}
