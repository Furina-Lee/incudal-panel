<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import TurnstileWidget from '@/components/TurnstileWidget.vue'
import api from '@/api'
import PublicAuthShell from '@/components/public/PublicAuthShell.vue'
import { useM3Auth } from '@/composables/useM3Auth'

const router = useRouter()
const { t } = useI18n()
const themeStore = useThemeStore()
const toast = useToast()
const { ui } = useM3Auth()

const email = ref<string>('')
const code = ref<string>('')
const loading = ref<boolean>(false)
const sendingCode = ref<boolean>(false)
const error = ref<string>('')
const success = ref<string>('')
const step = ref<'email' | 'verify'>('email')

// Turnstile 验证
const turnstileEnabled = ref<boolean>(false)
const turnstileSiteKey = ref<string>('')
const turnstileToken = ref<string>('')
const turnstileRef = ref<InstanceType<typeof TurnstileWidget> | null>(null)

onMounted(async (): Promise<void> => {
  try {
    const configResponse = await api.systemConfig.getPublic()
    turnstileEnabled.value = configResponse.turnstileEnabled || false
    turnstileSiteKey.value = configResponse.turnstileSiteKey || ''
  } catch (e) {
    console.error('Failed to load config:', e)
  }
})

function onTurnstileExpire() {
  turnstileToken.value = ''
}

async function sendVerificationCode(): Promise<void> {
  if (!email.value || !email.value.includes('@')) {
    error.value = t('auth.invalidEmail')
    return
  }

  if (turnstileEnabled.value && !turnstileToken.value) {
    error.value = t('auth.turnstileRequired')
    return
  }

  sendingCode.value = true
  error.value = ''
  success.value = ''

  try {
    await api.auth.sendForgotPasswordCode(email.value, turnstileEnabled.value ? turnstileToken.value : undefined)
    success.value = t('auth.forgotPassword.codeSent')
    step.value = 'verify'
    // Reset turnstile
    if (turnstileRef.value) {
      turnstileRef.value.reset?.()
    }
    turnstileToken.value = ''
  } catch (err: any) {
    error.value = err?.message || t('common.error')
    // Reset turnstile on error
    if (turnstileRef.value) {
      turnstileRef.value.reset?.()
    }
    turnstileToken.value = ''
  } finally {
    sendingCode.value = false
  }
}

async function resetPassword(): Promise<void> {
  if (!code.value || code.value.length !== 6) {
    error.value = t('auth.invalidCode')
    return
  }

  if (turnstileEnabled.value && !turnstileToken.value) {
    error.value = t('auth.turnstileRequired')
    return
  }

  loading.value = true
  error.value = ''
  success.value = ''

  try {
    const response = await api.auth.resetPassword(
      email.value,
      code.value,
      turnstileEnabled.value ? turnstileToken.value : undefined
    )
    
    toast.success(t('auth.forgotPassword.resetSuccess'))
    
    // 如果取消了2FA，显示提示
    if (response.twoFactorDisabled) {
      toast.info(t('auth.forgotPassword.twoFactorDisabled'))
    }
    
    // 跳转到登录页面
    setTimeout(() => {
      router.push('/login')
    }, 2000)
  } catch (err: any) {
    error.value = err?.message || t('common.error')
    // Reset turnstile on error
    if (turnstileRef.value) {
      turnstileRef.value.reset?.()
    }
    turnstileToken.value = ''
  } finally {
    loading.value = false
  }
}

function backToEmail() {
  step.value = 'email'
  code.value = ''
  error.value = ''
  success.value = ''
  if (turnstileRef.value) {
    turnstileRef.value.reset?.()
  }
  turnstileToken.value = ''
}
</script>

<template>
  <PublicAuthShell :title="$t('auth.forgotPassword.title')" :subtitle="$t('auth.forgotPassword.subtitle')">
    <div class="w-full rounded-[28px] p-6 sm:p-8" :class="ui.card">
      <!-- 步骤1：输入邮箱 -->
      <form v-if="step === 'email'" class="space-y-4" @submit.prevent="sendVerificationCode">
        <div>
          <label
            class="block text-sm mb-1.5"
            :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
          >{{ $t('auth.email') }}</label>
          <input
            v-model="email"
            type="email"
            :class="ui.input"
            :placeholder="$t('auth.emailPlaceholder')"
            autocomplete="email"
            required
          />
        </div>

        <!-- Turnstile 验证 -->
        <TurnstileWidget
          v-if="turnstileEnabled && turnstileSiteKey"
          ref="turnstileRef"
          v-model="turnstileToken"
          :site-key="turnstileSiteKey"
          :theme="themeStore.isDark ? 'dark' : 'light'"
          @expire="onTurnstileExpire"
        />

        <!-- 错误提示 -->
        <div v-if="error" class="rounded-xl px-4 py-3 text-sm leading-5" :class="ui.errorBanner" role="alert">
          {{ error }}
        </div>

        <!-- 成功提示 -->
        <div v-if="success" class="text-sm text-green-500">
          {{ success }}
        </div>

        <button
          type="submit"
          :disabled="sendingCode"
          :class="['inline-flex h-11 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60', ui.filled]"
        >
          {{ sendingCode ? $t('common.sending') : $t('auth.forgotPassword.sendCode') }}
        </button>

        <button
          type="button"
          :class="['inline-flex h-11 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold transition-colors', ui.text]"
          @click="router.push('/login')"
        >
          {{ $t('common.back') }}
        </button>
      </form>

      <!-- 步骤2：验证码验证 -->
      <form v-else class="space-y-4" @submit.prevent="resetPassword">
        <div>
          <label
            class="block text-sm mb-1.5"
            :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
          >{{ $t('auth.email') }}</label>
          <input
            :value="email"
            type="email"
            :class="ui.input"
            disabled
          />
        </div>

        <div>
          <label
            class="block text-sm mb-1.5"
            :class="themeStore.isDark ? 'text-gray-400' : 'text-gray-600'"
          >{{ $t('auth.verificationCode') }}</label>
          <input
            v-model="code"
            type="text"
            maxlength="6"
            :class="ui.input"
            :placeholder="$t('auth.verificationCodePlaceholder')"
            autocomplete="one-time-code"
            required
          />
          <p class="text-xs mt-1" :class="themeStore.isDark ? 'text-gray-500' : 'text-gray-500'">
            {{ $t('auth.forgotPassword.codeHint') }}
          </p>
        </div>

        <!-- Turnstile 验证 -->
        <TurnstileWidget
          v-if="turnstileEnabled && turnstileSiteKey"
          ref="turnstileRef"
          v-model="turnstileToken"
          :site-key="turnstileSiteKey"
          :theme="themeStore.isDark ? 'dark' : 'light'"
          @expire="onTurnstileExpire"
        />

        <!-- 错误提示 -->
        <div v-if="error" class="rounded-xl px-4 py-3 text-sm leading-5" :class="ui.errorBanner" role="alert">
          {{ error }}
        </div>

        <!-- 成功提示 -->
        <div v-if="success" class="text-sm text-green-500">
          {{ success }}
        </div>

        <button
          type="submit"
          :disabled="loading"
          :class="['inline-flex h-11 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60', ui.filled]"
        >
          {{ loading ? $t('common.processing') : $t('auth.forgotPassword.resetPassword') }}
        </button>

        <button
          type="button"
          :class="['inline-flex h-11 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold transition-colors', ui.text]"
          @click="backToEmail"
        >
          {{ $t('common.back') }}
        </button>
      </form>
    </div>

    <p class="mt-6 text-center text-sm" :class="themeStore.isDark ? 'text-gray-600' : 'text-gray-500'">
      {{ $t('auth.rememberPassword') }}
      <RouterLink
        to="/login"
        class="transition-colors"
        :class="themeStore.isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-700 hover:text-gray-900'"
      >
        {{ $t('auth.login') }}
      </RouterLink>
    </p>
  </PublicAuthShell>
</template>
