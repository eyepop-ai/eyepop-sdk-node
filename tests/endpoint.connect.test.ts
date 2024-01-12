import { MockServer } from 'jest-mock-server'
import {describe, expect, test} from '@jest/globals'
import {EyePopSdk} from '../src'
import {v4 as uuidv4} from 'uuid'

describe('EyePopSdk endpoint module auth and connect',  () => {
   const server = new MockServer()

  beforeAll(() => server.start())
  afterAll(() => server.stop())
  beforeEach(() => server.reset())

  test('EyePopSdk connect', async() => {
    const test_pop_id = uuidv4()
    const test_pipeline_id = uuidv4()
    const test_access_token = uuidv4()
    const token_valid_time = 1000 * 1000

    const authenticationRoute = server
      .post('/authentication/token')
      .mockImplementationOnce((ctx) => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({access_token:test_access_token,expires_in:token_valid_time,token_type:'Bearer'})
      })

    const popConfigRoute = server
      .get(`/pops/${test_pop_id}/config`)
      .mockImplementationOnce((ctx) => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({base_url:`${server.getURL()}worker/`,pipeline_id:test_pipeline_id})
      })

    const endpoint = EyePopSdk.endpoint({
      eyepopUrl: server.getURL().toString(),
      popId: test_pop_id
    })
    expect(endpoint).toBeDefined()
    try {
      await endpoint.open()
      expect(authenticationRoute).toHaveBeenCalledTimes(1)
      expect(popConfigRoute).toHaveBeenCalledTimes(1)
    }finally {
      await endpoint.close()
    }
  })

  test('EyePopSdk reuse token', async() => {
    const test_pop_id = uuidv4()
    const test_pipeline_id = uuidv4()
    const test_access_token = uuidv4()
    const long_token_valid_time = 1000 * 1000

    const authenticationRoute = server
      .post('/authentication/token')
      .mockImplementation((ctx) => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({access_token:test_access_token,expires_in:long_token_valid_time,token_type:'Bearer'})
      })

    const popConfigRoute = server
      .get(`/pops/${test_pop_id}/config`)
      .mockImplementation((ctx) => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({base_url:`${server.getURL()}worker/`,pipeline_id:test_pipeline_id})
      })

    const endpoint = EyePopSdk.endpoint({
      eyepopUrl: server.getURL().toString(),
      popId: test_pop_id
    })
    expect(endpoint).toBeDefined()
    try {
      await endpoint.open()
      expect(authenticationRoute).toHaveBeenCalledTimes(1)
      expect(popConfigRoute).toHaveBeenCalledTimes(1)
    }finally {
      await endpoint.close()
    }
    // token should be reused
    try {
      await endpoint.open()
      expect(authenticationRoute).toHaveBeenCalledTimes(1)
      expect(popConfigRoute).toHaveBeenCalledTimes(2)
    }finally {
      await endpoint.close()
    }
  })

  test('EyePopSdk re-auth on expired token', async() => {
    const test_pop_id = uuidv4()
    const test_pipeline_id = uuidv4()
    const test_access_token = uuidv4()
    const short_token_valid_time = 1
    const long_token_valid_time = 1000*1000

    const authenticationRoute = server
      .post('/authentication/token')
      .mockImplementationOnce((ctx) => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({access_token:test_access_token,expires_in:short_token_valid_time,token_type:'Bearer'})
      })
      .mockImplementationOnce((ctx) => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({access_token:test_access_token,expires_in:long_token_valid_time,token_type:'Bearer'})
      })

    const popConfigRoute = server
      .get(`/pops/${test_pop_id}/config`)
      .mockImplementation((ctx) => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({base_url:`${server.getURL()}worker/`,pipeline_id:test_pipeline_id})
      })

    const endpoint = EyePopSdk.endpoint({
      eyepopUrl: server.getURL().toString(),
      popId: test_pop_id
    })
    expect(endpoint).toBeDefined()
    try {
      await endpoint.open()
      expect(authenticationRoute).toHaveBeenCalledTimes(1)
      expect(popConfigRoute).toHaveBeenCalledTimes(1)
    }finally {
      await endpoint.close()
    }
    // token should have expired by now
    try {
      await endpoint.open()
      expect(authenticationRoute).toHaveBeenCalledTimes(2)
      expect(popConfigRoute).toHaveBeenCalledTimes(2)
    }finally {
      await endpoint.close()
    }
  })

  test('EyePopSdk re-auth on 401', async() => {
    const test_pop_id = uuidv4()
    const test_pipeline_id = uuidv4()
    const test_access_token = uuidv4()
    const token_valid_time = 1000 * 1000

    const authenticationRoute = server
      .post('/authentication/token')
      .mockImplementation((ctx) => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({access_token:test_access_token,expires_in:token_valid_time,token_type:'Bearer'})
      })

    const popConfigRoute = server
      .get(`/pops/${test_pop_id}/config`)
      .mockImplementationOnce((ctx) => {
        ctx.status = 401
      })
      .mockImplementationOnce((ctx) => {
        ctx.status = 200
        ctx.response.headers['content-type'] = 'application/json'
        ctx.body = JSON.stringify({base_url:`${server.getURL()}worker/`,pipeline_id:test_pipeline_id})
      })

    const endpoint = EyePopSdk.endpoint({
      eyepopUrl: server.getURL().toString(),
      popId: test_pop_id
    })
    expect(endpoint).toBeDefined()
    try {
      await endpoint.open()
      expect(authenticationRoute).toHaveBeenCalledTimes(2)
      expect(popConfigRoute).toHaveBeenCalledTimes(2)
    }finally {
      await endpoint.close()
    }
  })
})
