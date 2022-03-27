import { ChannelCredentials } from '@grpc/grpc-js'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { SetUsersRequest_Operation } from '../protobuf/api'
import { TrojanServerServiceClient } from '../protobuf/api.client'
import Sentry from '../sentry'
import { ECommand } from '../types'
import { DBClient } from './db'
import { AddResult, FlowResult, ListResult, RemoveResult } from './types'

interface APIClientProps {
  host: string
  port: number
}

const passwordHashToAccountMap = new Map<
  string,
  {
    accountId: number
  }
>()
const accountIdToPasswordHashMap = new Map<number, string>()

export class APIClient extends DBClient {
  private cl: TrojanServerServiceClient
  private transport: GrpcTransport

  constructor({ host, port }: APIClientProps) {
    super()

    this.transport = new GrpcTransport({
      host: `${host}:${port}`,
      channelCredentials: ChannelCredentials.createInsecure(),
    })
    this.cl = new TrojanServerServiceClient(this.transport)
  }

  public async listAccounts(): Promise<ListResult> {
    try {
      const streamingCall = this.cl.listUsers({})
      const accounts: Array<{
        id: number
        password: string
      }> = []

      for await (const user of streamingCall.responses) {
        const { status } = user
        const hash = status?.user?.hash

        if (!hash) continue

        const account = passwordHashToAccountMap.get(hash)

        if (!account) continue

        accounts.push({
          id: account.accountId,
          password: hash,
        })
      }

      await streamingCall

      return { type: ECommand.List, data: accounts }
    } catch (e) {
      if (e instanceof Error) {
        Sentry.captureException(e)
        throw new Error("Query error on 'list': " + e.message)
      }
      throw new Error("Query error on 'list': " + e)
    }
  }

  public async addAccount(
    acctId: number,
    passwordHash: string,
  ): Promise<AddResult> {
    try {
      const streamingCall = this.cl.setUsers()

      await streamingCall.requests.send({
        operation: SetUsersRequest_Operation.Add,
        status: {
          ipLimit: 0,
          ipCurrent: 0,
          user: {
            password: '',
            hash: passwordHash,
          },
        },
      })

      await streamingCall

      passwordHashToAccountMap.set(passwordHash, {
        accountId: acctId,
      })
      accountIdToPasswordHashMap.set(acctId, passwordHash)

      return { type: ECommand.Add, id: acctId }
    } catch (e) {
      if (e instanceof Error) {
        Sentry.captureException(e)
        throw new Error("Query error on 'add': " + e.message)
      }
      throw new Error("Query error on 'add': " + e)
    }
  }

  public async removeAccount(acctId: number): Promise<RemoveResult> {
    try {
      const streamingCall = this.cl.setUsers()
      const passwordHash = accountIdToPasswordHashMap.get(acctId)

      if (!passwordHash) {
        throw new Error('Could not find the account ' + acctId)
      }

      await streamingCall.requests.send({
        operation: SetUsersRequest_Operation.Delete,
        status: {
          ipLimit: 0,
          ipCurrent: 0,
          user: {
            hash: passwordHash,
            password: '',
          },
        },
      })

      await streamingCall

      accountIdToPasswordHashMap.delete(acctId)
      passwordHashToAccountMap.delete(passwordHash)

      return { type: ECommand.Delete, id: acctId }
    } catch (e) {
      if (e instanceof Error) {
        Sentry.captureException(e)
        throw new Error("Query error on 'del': " + e.message)
      }
      throw new Error("Query error on 'del': " + e)
    }
  }

  public async getFlow(options: { clear?: boolean } = {}): Promise<FlowResult> {
    try {
      const streamingCall = this.cl.listUsers({})
      const accounts: Array<{
        id: number
        flow: number
      }> = []

      for await (const user of streamingCall.responses) {
        const { status } = user
        const hash = status?.user?.hash
        const upload = status?.trafficTotal?.uploadTraffic
        const download = status?.trafficTotal?.downloadTraffic

        if (!hash) continue

        const account = passwordHashToAccountMap.get(hash)

        if (!account) continue

        const uploadInNumber = upload ? Number(upload) : 0
        const downloadInNumber = download ? Number(download) : 0

        accounts.push({
          id: account.accountId,
          flow: downloadInNumber + uploadInNumber,
        })

        if (options.clear) {
          const setUserCall = this.cl.setUsers()

          await setUserCall.requests.send({
            operation: SetUsersRequest_Operation.Modify,
            status: {
              ipLimit: 0,
              ipCurrent: 0,
              user: {
                password: '',
                hash,
              },
              trafficTotal: {
                uploadTraffic: 0n,
                downloadTraffic: 0n,
              },
            },
          })

          await setUserCall
        }
      }

      await streamingCall

      return { type: ECommand.Flow, data: accounts }
    } catch (e) {
      if (e instanceof Error) {
        Sentry.captureException(e)
        throw new Error("Query error on 'flow': " + e.message)
      }
      throw new Error("Query error on 'flow': " + e)
    }
  }

  public disconnect(): void {
    this.transport.close()
  }
}