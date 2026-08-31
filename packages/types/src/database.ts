export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          block: string
          created_at: string
          customer_id: string
          floor: string | null
          id: string
          is_default: boolean
          landmark: string | null
          room: string
          zone_id: string
        }
        Insert: {
          block: string
          created_at?: string
          customer_id: string
          floor?: string | null
          id?: string
          is_default?: boolean
          landmark?: string | null
          room: string
          zone_id: string
        }
        Update: {
          block?: string
          created_at?: string
          customer_id?: string
          floor?: string | null
          id?: string
          is_default?: boolean
          landmark?: string | null
          room?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addresses_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          config: Json
          created_at: string
          ends_at: string | null
          id: string
          name: string
          starts_at: string
          type: string
        }
        Insert: {
          config?: Json
          created_at?: string
          ends_at?: string | null
          id?: string
          name: string
          starts_at: string
          type: string
        }
        Update: {
          config?: Json
          created_at?: string
          ends_at?: string | null
          id?: string
          name?: string
          starts_at?: string
          type?: string
        }
        Relationships: []
      }
      inventory: {
        Row: {
          created_at: string
          id: string
          product_id: string
          qty_on_hand: number
          qty_reserved: number
          store_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          qty_on_hand?: number
          qty_reserved?: number
          store_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          qty_on_hand?: number
          qty_reserved?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          attempts: number
          body: string
          created_at: string
          event: string
          id: string
          last_error: string | null
          order_id: string
          profile_id: string
          sent_at: string | null
          title: string
        }
        Insert: {
          attempts?: number
          body: string
          created_at?: string
          event: string
          id?: string
          last_error?: string | null
          order_id: string
          profile_id: string
          sent_at?: string | null
          title: string
        }
        Update: {
          attempts?: number
          body?: string
          created_at?: string
          event?: string
          id?: string
          last_error?: string | null
          order_id?: string
          profile_id?: string
          sent_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_outbox_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_delivery_codes: {
        Row: {
          code: string
          created_at: string
          order_id: string
        }
        Insert: {
          code: string
          created_at?: string
          order_id: string
        }
        Update: {
          code?: string
          created_at?: string
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_delivery_codes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          fulfilled_qty: number
          id: string
          order_id: string
          product_id: string
          qty: number
          stock_out_at: string | null
          stock_out_by: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          fulfilled_qty?: number
          id?: string
          order_id: string
          product_id: string
          qty: number
          stock_out_at?: string | null
          stock_out_by?: string | null
          unit_price: number
        }
        Update: {
          created_at?: string
          fulfilled_qty?: number
          id?: string
          order_id?: string
          product_id?: string
          qty?: number
          stock_out_at?: string | null
          stock_out_by?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_stock_out_by_fkey"
            columns: ["stock_out_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_transition_rules: {
        Row: {
          actor: string
          from_status: Database["public"]["Enums"]["order_status"]
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          actor: string
          from_status: Database["public"]["Enums"]["order_status"]
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          actor?: string
          from_status?: Database["public"]["Enums"]["order_status"]
          to_status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: []
      }
      orders: {
        Row: {
          address_id: string
          assigned_at: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          confirmed_at: string | null
          customer_id: string
          delivered_at: string | null
          delivery_code_hash: string | null
          delivery_fee: number
          discount: number
          id: string
          idempotency_key: string
          idempotency_request_hash: string | null
          packed_at: string | null
          payable: number
          payment_status: Database["public"]["Enums"]["payment_status"]
          picked_up_at: string | null
          placed_at: string
          reservation_expires_at: string
          runner_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
          subtotal: number
          wallet_applied: number
        }
        Insert: {
          address_id: string
          assigned_at?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          customer_id: string
          delivered_at?: string | null
          delivery_code_hash?: string | null
          delivery_fee: number
          discount?: number
          id?: string
          idempotency_key: string
          idempotency_request_hash?: string | null
          packed_at?: string | null
          payable: number
          payment_status?: Database["public"]["Enums"]["payment_status"]
          picked_up_at?: string | null
          placed_at?: string
          reservation_expires_at?: string
          runner_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          store_id: string
          subtotal: number
          wallet_applied?: number
        }
        Update: {
          address_id?: string
          assigned_at?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          customer_id?: string
          delivered_at?: string | null
          delivery_code_hash?: string | null
          delivery_fee?: number
          discount?: number
          id?: string
          idempotency_key?: string
          idempotency_request_hash?: string | null
          packed_at?: string | null
          payable?: number
          payment_status?: Database["public"]["Enums"]["payment_status"]
          picked_up_at?: string | null
          placed_at?: string
          reservation_expires_at?: string
          runner_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          store_id?: string
          subtotal?: number
          wallet_applied?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_runner_id_fkey"
            columns: ["runner_id"]
            isOneToOne: false
            referencedRelation: "runners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_order_consistency_rules: {
        Row: {
          order_status: Database["public"]["Enums"]["order_status"]
          payment_status: Database["public"]["Enums"]["payment_status"]
        }
        Insert: {
          order_status: Database["public"]["Enums"]["order_status"]
          payment_status: Database["public"]["Enums"]["payment_status"]
        }
        Update: {
          order_status?: Database["public"]["Enums"]["order_status"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
        }
        Relationships: []
      }
      payment_transition_rules: {
        Row: {
          from_status: Database["public"]["Enums"]["payment_status"]
          to_status: Database["public"]["Enums"]["payment_status"]
        }
        Insert: {
          from_status: Database["public"]["Enums"]["payment_status"]
          to_status: Database["public"]["Enums"]["payment_status"]
        }
        Update: {
          from_status?: Database["public"]["Enums"]["payment_status"]
          to_status?: Database["public"]["Enums"]["payment_status"]
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          gateway: string | null
          gateway_intent_requested_at: string | null
          gateway_order_ref: string | null
          gateway_payment_ref: string | null
          id: string
          order_id: string
          raw_event: Json | null
          refunded_amount: number
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          gateway?: string | null
          gateway_intent_requested_at?: string | null
          gateway_order_ref?: string | null
          gateway_payment_ref?: string | null
          id?: string
          order_id: string
          raw_event?: Json | null
          refunded_amount?: number
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          gateway?: string | null
          gateway_intent_requested_at?: string | null
          gateway_order_ref?: string | null
          gateway_payment_ref?: string | null
          id?: string
          order_id?: string
          raw_event?: Json | null
          refunded_amount?: number
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          brand: string | null
          category: string
          created_at: string
          id: string
          image_url: string | null
          is_listed: boolean
          mrp: number
          name: string
          sale_price: number
          sort_order: number
          store_id: string
          unit_label: string | null
        }
        Insert: {
          brand?: string | null
          category: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_listed?: boolean
          mrp: number
          name: string
          sale_price: number
          sort_order?: number
          store_id: string
          unit_label?: string | null
        }
        Update: {
          brand?: string | null
          category?: string
          created_at?: string
          id?: string
          image_url?: string | null
          is_listed?: boolean
          mrp?: number
          name?: string
          sale_price?: number
          sort_order?: number
          store_id?: string
          unit_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          acquisition_campaign_id: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string
          referral_code: string | null
          wallet_balance: number
        }
        Insert: {
          acquisition_campaign_id?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          phone: string
          referral_code?: string | null
          wallet_balance?: number
        }
        Update: {
          acquisition_campaign_id?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string
          referral_code?: string | null
          wallet_balance?: number
        }
        Relationships: [
          {
            foreignKeyName: "profiles_acquisition_campaign_id_fkey"
            columns: ["acquisition_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_redemptions: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          order_id: string | null
          promo_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          order_id?: string | null
          promo_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          order_id?: string | null
          promo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_redemptions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_redemptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_redemptions_promo_id_fkey"
            columns: ["promo_id"]
            isOneToOne: false
            referencedRelation: "promos"
            referencedColumns: ["id"]
          },
        ]
      }
      promos: {
        Row: {
          campaign_id: string | null
          code: string
          created_at: string
          id: string
          max_uses: number | null
          per_user_limit: number
          type: string
          uses_count: number
          valid_from: string
          valid_to: string | null
          value: number
        }
        Insert: {
          campaign_id?: string | null
          code: string
          created_at?: string
          id?: string
          max_uses?: number | null
          per_user_limit?: number
          type: string
          uses_count?: number
          valid_from: string
          valid_to?: string | null
          value: number
        }
        Update: {
          campaign_id?: string | null
          code?: string
          created_at?: string
          id?: string
          max_uses?: number | null
          per_user_limit?: number
          type?: string
          uses_count?: number
          valid_from?: string
          valid_to?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "promos_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          platform: string
          profile_id: string
          token: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform: string
          profile_id: string
          token: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          profile_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_events: {
        Row: {
          action: string
          created_at: string
          id: string
          subject: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          subject: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          subject?: string
        }
        Relationships: []
      }
      refunds: {
        Row: {
          actor_id: string | null
          amount: number
          created_at: string
          gateway_refund_ref: string | null
          id: string
          idempotency_key: string
          payment_id: string
          reason: string
        }
        Insert: {
          actor_id?: string | null
          amount: number
          created_at?: string
          gateway_refund_ref?: string | null
          id?: string
          idempotency_key: string
          payment_id: string
          reason: string
        }
        Update: {
          actor_id?: string | null
          amount?: number
          created_at?: string
          gateway_refund_ref?: string | null
          id?: string
          idempotency_key?: string
          payment_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments_customer_view"
            referencedColumns: ["id"]
          },
        ]
      }
      runner_earnings: {
        Row: {
          amount: number
          created_at: string
          id: string
          order_id: string
          runner_id: string
          settled_at: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          order_id: string
          runner_id: string
          settled_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          order_id?: string
          runner_id?: string
          settled_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "runner_earnings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runner_earnings_runner_id_fkey"
            columns: ["runner_id"]
            isOneToOne: false
            referencedRelation: "runners"
            referencedColumns: ["id"]
          },
        ]
      }
      runners: {
        Row: {
          id: string
          is_online: boolean
          joined_at: string
          profile_id: string
          store_id: string
        }
        Insert: {
          id?: string
          is_online?: boolean
          joined_at?: string
          profile_id: string
          store_id: string
        }
        Update: {
          id?: string
          is_online?: boolean
          joined_at?: string
          profile_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "runners_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runners_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          profile_id: string
          role: Database["public"]["Enums"]["user_role"]
          store_id: string | null
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          profile_id: string
          role: Database["public"]["Enums"]["user_role"]
          store_id?: string | null
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          profile_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_roles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_roles_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          closes_at: string | null
          created_at: string
          id: string
          is_open: boolean
          max_queue_depth: number
          name: string
          opens_at: string | null
          pause_reason: string | null
        }
        Insert: {
          closes_at?: string | null
          created_at?: string
          id?: string
          is_open?: boolean
          max_queue_depth?: number
          name: string
          opens_at?: string | null
          pause_reason?: string | null
        }
        Update: {
          closes_at?: string | null
          created_at?: string
          id?: string
          is_open?: boolean
          max_queue_depth?: number
          name?: string
          opens_at?: string | null
          pause_reason?: string | null
        }
        Relationships: []
      }
      wallet_ledger: {
        Row: {
          created_at: string
          customer_id: string
          delta: number
          id: string
          order_id: string | null
          reason: Database["public"]["Enums"]["wallet_ledger_reason"]
        }
        Insert: {
          created_at?: string
          customer_id: string
          delta: number
          id?: string
          order_id?: string | null
          reason: Database["public"]["Enums"]["wallet_ledger_reason"]
        }
        Update: {
          created_at?: string
          customer_id?: string
          delta?: number
          id?: string
          order_id?: string | null
          reason?: Database["public"]["Enums"]["wallet_ledger_reason"]
        }
        Relationships: [
          {
            foreignKeyName: "wallet_ledger_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          created_at: string
          gateway: string
          gateway_event_id: string
          id: string
          payload: Json
          processed_at: string | null
        }
        Insert: {
          created_at?: string
          gateway: string
          gateway_event_id: string
          id?: string
          payload: Json
          processed_at?: string | null
        }
        Update: {
          created_at?: string
          gateway?: string
          gateway_event_id?: string
          id?: string
          payload?: Json
          processed_at?: string | null
        }
        Relationships: []
      }
      zones: {
        Row: {
          created_at: string
          delivery_fee: number
          id: string
          is_serviceable: boolean
          name: string
          store_id: string
        }
        Insert: {
          created_at?: string
          delivery_fee: number
          id?: string
          is_serviceable?: boolean
          name: string
          store_id: string
        }
        Update: {
          created_at?: string
          delivery_fee?: number
          id?: string
          is_serviceable?: boolean
          name?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zones_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      payments_admin_view: {
        Row: {
          amount: number | null
          created_at: string | null
          gateway: string | null
          gateway_intent_requested_at: string | null
          gateway_order_ref: string | null
          gateway_payment_ref: string | null
          id: string | null
          order_id: string | null
          raw_event: Json | null
          refunded_amount: number | null
          status: Database["public"]["Enums"]["payment_status"] | null
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          gateway?: string | null
          gateway_intent_requested_at?: string | null
          gateway_order_ref?: string | null
          gateway_payment_ref?: string | null
          id?: string | null
          order_id?: string | null
          raw_event?: Json | null
          refunded_amount?: number | null
          status?: Database["public"]["Enums"]["payment_status"] | null
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          gateway?: string | null
          gateway_intent_requested_at?: string | null
          gateway_order_ref?: string | null
          gateway_payment_ref?: string | null
          id?: string | null
          order_id?: string | null
          raw_event?: Json | null
          refunded_amount?: number | null
          status?: Database["public"]["Enums"]["payment_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payments_customer_view: {
        Row: {
          amount: number | null
          created_at: string | null
          id: string | null
          order_id: string | null
          refunded_amount: number | null
          status: Database["public"]["Enums"]["payment_status"] | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          id?: string | null
          order_id?: string | null
          refunded_amount?: number | null
          status?: Database["public"]["Enums"]["payment_status"] | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          id?: string | null
          order_id?: string | null
          refunded_amount?: number | null
          status?: Database["public"]["Enums"]["payment_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      products_with_availability: {
        Row: {
          brand: string | null
          category: string | null
          created_at: string | null
          id: string | null
          image_url: string | null
          is_available: boolean | null
          is_listed: boolean | null
          mrp: number | null
          name: string | null
          sale_price: number | null
          sort_order: number | null
          store_id: string | null
          unit_label: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      assert_fulfilment_actor: {
        Args: { p_actor_id: string; p_store_id: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      assert_runner_actor: {
        Args: { p_actor_id: string; p_store_id: string }
        Returns: {
          role: Database["public"]["Enums"]["user_role"]
          runner_id: string
        }[]
      }
      auth_role: { Args: never; Returns: string }
      auth_runner_id: { Args: never; Returns: string }
      auth_store_id: { Args: never; Returns: string }
      claim_notification_batch: {
        Args: { p_limit?: number }
        Returns: {
          body: string
          event: string
          order_id: string
          outbox_id: string
          platform: string
          title: string
          token: string
        }[]
      }
      claim_payment_intent: { Args: { p_order_id: string }; Returns: Json }
      create_order_phase_a: {
        Args: {
          p_address_id: string
          p_customer_id: string
          p_idempotency_key: string
          p_items: Json
          p_promo_code?: string
          p_request_hash?: string
          p_use_wallet?: boolean
        }
        Returns: Json
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      delete_push_token: { Args: { p_token: string }; Returns: undefined }
      expire_stale_reservations: { Args: never; Returns: number }
      find_wallet_balance_mismatches: {
        Args: never
        Returns: {
          cached_balance: number
          customer_id: string
          ledger_sum: number
        }[]
      }
      mark_notification_sent: {
        Args: { p_error?: string; p_outbox_id: string }
        Returns: undefined
      }
      persist_gateway_ref: {
        Args: { p_gateway_order_ref: string; p_order_id: string }
        Returns: undefined
      }
      process_admin_reassign: {
        Args: { p_actor_id: string; p_order_id: string; p_runner_id?: string }
        Returns: Json
      }
      process_claim_job: {
        Args: { p_actor_id: string; p_order_id: string }
        Returns: Json
      }
      process_mark_delivery_failed: {
        Args: { p_actor_id: string; p_order_id: string; p_reason: string }
        Returns: Json
      }
      process_mark_packed: {
        Args: { p_actor_id: string; p_order_id: string }
        Returns: Json
      }
      process_mark_picked_up: {
        Args: { p_actor_id: string; p_order_id: string }
        Returns: Json
      }
      process_payment_webhook: {
        Args: {
          p_amount: number
          p_currency: string
          p_event_id: string
          p_gateway: string
          p_order_ref: string
          p_outcome: string
          p_payload: Json
          p_payment_ref: string
        }
        Returns: Json
      }
      process_refund: {
        Args: {
          p_actor_id: string
          p_amount: number
          p_destination?: string
          p_idempotency_key: string
          p_order_id: string
          p_reason: string
        }
        Returns: Json
      }
      process_register_push_token: {
        Args: { p_platform: string; p_profile_id: string; p_token: string }
        Returns: Json
      }
      process_release_job: {
        Args: { p_actor_id: string; p_order_id: string; p_reason?: string }
        Returns: Json
      }
      process_stock_out: {
        Args: {
          p_actor_id: string
          p_available_qty: number
          p_delist: boolean
          p_idempotency_key: string
          p_order_id: string
          p_order_item_id: string
        }
        Returns: Json
      }
      process_verify_delivery_code: {
        Args: { p_actor_id: string; p_code: string; p_order_id: string }
        Returns: Json
      }
      promo_order_discount: {
        Args: { p_subtotal: number; p_type: string; p_value: number }
        Returns: number
      }
      promo_redeemability: {
        Args: {
          p_customer_id: string
          p_promo: Database["public"]["Tables"]["promos"]["Row"]
        }
        Returns: string
      }
      staff_scope: {
        Args: { p_profile_id: string }
        Returns: {
          role: Database["public"]["Enums"]["user_role"]
          store_id: string
        }[]
      }
      validate_promo_preview: {
        Args: { p_code: string; p_customer_id: string; p_subtotal: number }
        Returns: Json
      }
    }
    Enums: {
      order_status:
        | "created"
        | "confirmed"
        | "packed"
        | "assigned"
        | "picked_up"
        | "delivered"
        | "payment_failed"
        | "cancelled"
        | "delivery_failed"
      payment_status:
        | "pending"
        | "captured"
        | "failed"
        | "refunded"
        | "partially_refunded"
      user_role: "packer" | "runner" | "admin"
      wallet_ledger_reason:
        | "promo_credit"
        | "referral_credit"
        | "refund"
        | "manual_adjustment"
        | "checkout_redemption"
        | "reservation_reversal"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      order_status: [
        "created",
        "confirmed",
        "packed",
        "assigned",
        "picked_up",
        "delivered",
        "payment_failed",
        "cancelled",
        "delivery_failed",
      ],
      payment_status: [
        "pending",
        "captured",
        "failed",
        "refunded",
        "partially_refunded",
      ],
      user_role: ["packer", "runner", "admin"],
      wallet_ledger_reason: [
        "promo_credit",
        "referral_credit",
        "refund",
        "manual_adjustment",
        "checkout_redemption",
        "reservation_reversal",
      ],
    },
  },
} as const

