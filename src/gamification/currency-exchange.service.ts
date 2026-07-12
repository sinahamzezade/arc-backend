import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import {
  CURRENCY_PACKS,
  findCurrencyPack,
  type CurrencyPackPaymentMethod,
} from './currency-packs.constants';
import {
  RewardCurrency,
  RewardReasonType,
} from './entities/reward-ledger-entry.entity';
import { RewardLedgerService } from './reward-ledger.service';

@Injectable()
export class CurrencyExchangeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: RewardLedgerService,
  ) {}

  listPacks(filters?: { target?: 'gems' | 'coins' }) {
    return CURRENCY_PACKS.filter((p) =>
      filters?.target ? p.target === filters.target : true,
    ).map((p) => ({
      sku: p.sku,
      title: p.title,
      description: p.description,
      target: p.target,
      amount: p.amount,
      xpPrice: p.xpPrice,
      /** Present for future IAP; null product still listed when method disabled. */
      iapProductId: p.iapProductId,
      paymentMethods: [...p.paymentMethods],
    }));
  }

  async purchaseWithXp(input: {
    userId: string;
    sku: string;
    idempotencyKey: string;
  }) {
    const pack = findCurrencyPack(input.sku);
    if (!pack) {
      throw new AppException(
        AuthErrorCode.ITEM_NOT_AVAILABLE,
        'Currency pack not found',
        HttpStatus.NOT_FOUND,
      );
    }

    this.assertPaymentEnabled(pack.paymentMethods, 'xp');

    return this.dataSource.transaction(async (manager) => {
      const wallet = await this.ledger.ensureWallet(manager, input.userId, true);
      if (wallet.lifetimeXp < pack.xpPrice) {
        throw new AppException(
          AuthErrorCode.INSUFFICIENT_XP,
          'Insufficient XP',
        );
      }

      const creditCurrency =
        pack.target === 'gems' ? RewardCurrency.Gems : RewardCurrency.Coins;

      const grant = await this.ledger.grantReward(manager, {
        userId: input.userId,
        reasonType: RewardReasonType.Store,
        reasonId: wallet.id,
        idempotencyKey: `currency-pack:${input.idempotencyKey}`,
        metadata: {
          kind: 'currency_pack',
          paymentMethod: 'xp',
          sku: pack.sku,
          target: pack.target,
          amount: pack.amount,
          xpPrice: pack.xpPrice,
        },
        lines: [
          {
            currency: RewardCurrency.LifetimeXp,
            amount: -pack.xpPrice,
            idempotencySuffix: 'xp-spend',
          },
          {
            currency: creditCurrency,
            amount: pack.amount,
            idempotencySuffix: 'credit',
          },
        ],
      });

      return {
        alreadyPurchased: grant.alreadyGranted,
        transactionGroupId: grant.transactionGroupId,
        wallet: grant.wallet,
        pack: {
          sku: pack.sku,
          target: pack.target,
          amount: pack.amount,
          xpPrice: pack.xpPrice,
          paymentMethod: 'xp' as const,
        },
      };
    });
  }

  /**
   * Stub for future IAP settlement.
   * Verify receipt externally, then call with paymentMethod=iap.
   */
  async purchaseWithIap(_input: {
    userId: string;
    sku: string;
    idempotencyKey: string;
    receipt: string;
  }): Promise<never> {
    throw new AppException(
      AuthErrorCode.ITEM_NOT_AVAILABLE,
      'Real-money packs coming soon',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  private assertPaymentEnabled(
    methods: CurrencyPackPaymentMethod[],
    method: CurrencyPackPaymentMethod,
  ) {
    if (!methods.includes(method)) {
      throw new AppException(
        AuthErrorCode.ITEM_NOT_AVAILABLE,
        `Payment method ${method} not enabled for this pack`,
      );
    }
  }
}
