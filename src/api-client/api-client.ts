import { Op } from 'sequelize'
import { Account, Flow } from '../models'
import { ECommand } from '../types'
import {
  AddResult,
  ChangePasswordResult,
  FlowResult,
  ListResult,
  RemoveResult,
} from './types'
import { TrojanManager } from './trojan-manager'

interface APIClientProps {
  host: string
  port: number
}

export class APIClient {
  private readonly trojanManager: TrojanManager

  constructor({ host, port }: APIClientProps) {
    this.trojanManager = new TrojanManager({ host, port })
  }

  public async init({
    onTickError,
  }: {
    onTickError: (error: Error) => void
  }): Promise<void> {
    await this.onTick()

    setInterval(() => {
      this.onTick().catch((err) => {
        if (err instanceof Error) {
          try {
            onTickError(err)
          } catch (_) {
            // ignore
          }
        }
      })
    }, 60 * 1000)
  }

  public async listAccounts(): Promise<ListResult> {
    const accounts = await Account.findAll()

    return { type: ECommand.List, data: accounts }
  }

  public async addAccount(
    accountId: number,
    passwordHash: string,
  ): Promise<AddResult> {
    await Account.findOrCreate({
      where: { id: accountId },
      defaults: { id: accountId, password: passwordHash },
    })

    return { type: ECommand.Add, accountId }
  }

  public async removeAccount(accountId: number): Promise<RemoveResult> {
    await Account.destroy({
      where: {
        id: accountId,
      },
    })

    return { type: ECommand.Delete, accountId }
  }

  public async changePassword(
    accountId: number,
    passwordHash: string,
  ): Promise<ChangePasswordResult> {
    await this.removeAccount(accountId)
    await this.addAccount(accountId, passwordHash)

    return {
      type: ECommand.ChangePassword,
      accountId,
      password: passwordHash,
    }
  }

  public async getFlow(
    options: { clear?: boolean; startTime?: number; endTime?: number } = {},
  ): Promise<FlowResult> {
    const startTime = options.startTime || 0
    const endTime = options.endTime || Date.now()
    const accountFlows = await Account.findAll({
      include: [
        {
          association: Account.associations.flows,
          where: {
            createdAt: {
              [Op.between]: [startTime, endTime],
            },
          },
        },
      ],
    })
    const results = accountFlows.map((account) => {
      const flows = account.flows
      let flow = 0

      if (flows) {
        flows.forEach((f) => {
          flow += f.flow
        })
      }

      return {
        accountId: account.id,
        flow,
      }
    })

    if (options.clear) {
      await Flow.destroy({
        where: {
          createdAt: {
            [Op.between]: [startTime, endTime],
          },
        },
      })
    }

    return { type: ECommand.Flow, data: results }
  }

  public disconnect(): void {
    this.trojanManager.disconnect()
  }

  private async onTick(): Promise<void> {
    const [dbAccounts, trojanInMemoryAccountFlows] = await Promise.all([
      Account.findAll(),
      this.trojanManager.getFlows(),
    ])
    const passwordsToAdd: string[] = []
    const flowsToAdd = []
    const passwordsToRemove = trojanInMemoryAccountFlows.map(
      (f) => f.passwordHash,
    )

    for await (const account of dbAccounts) {
      const { password } = account
      const inMemoryAccountIndex = trojanInMemoryAccountFlows.findIndex(
        (f) => f.passwordHash === password,
      )
      const flows = trojanInMemoryAccountFlows
        .filter((flow) => flow.passwordHash === account.password)
        .map((flow) => ({
          accountId: account.id,
          flow: flow.flow,
        }))

      flowsToAdd.push(...flows)

      if (inMemoryAccountIndex > -1) {
        // Account exists in memory and database, keep it in the memory
        passwordsToRemove.splice(inMemoryAccountIndex, 1)
      } else {
        // Account doesn't exist in memory, add it to memory
        passwordsToAdd.push(password)
      }
    }

    await Flow.bulkCreate(flowsToAdd)

    // Reset all flows
    await this.trojanManager.clearFlow(
      trojanInMemoryAccountFlows.map((flow) => flow.passwordHash),
    )

    if (passwordsToAdd.length) {
      await this.trojanManager.addAccount(passwordsToAdd)
    }

    if (passwordsToRemove.length) {
      // Passwords left in the array are not in the database, remove them from memory
      await this.trojanManager.removeAccount(passwordsToRemove)
    }
  }
}
