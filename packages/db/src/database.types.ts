// -----------------------------------------------------------------------------
// NWS Commerce - database types
//
// Generated from the live schema in `database_to_paste.sql`. Do not edit by hand:
// re-run `npm run db:types` after changing the schema.
// -----------------------------------------------------------------------------

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      approvals: {
        Row: {
          id: string;
          organization_id: string;
          purpose: string;
          approver_id: string;
          requested_by: string;
          max_discount_percent: number;
          expires_at: string;
          used_at: string | null;
          order_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          purpose: string;
          approver_id: string;
          requested_by: string;
          max_discount_percent: number;
          expires_at: string;
          used_at?: string | null;
          order_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          purpose?: string;
          approver_id?: string;
          requested_by?: string;
          max_discount_percent?: number;
          expires_at?: string;
          used_at?: string | null;
          order_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "approvals_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      attribute_definitions: {
        Row: {
          id: string;
          organization_id: string;
          code: string;
          label: string;
          data_type: Enums["attribute_type"];
          unit: string | null;
          options: string[] | null;
          is_filterable: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          code: string;
          label: string;
          data_type: Enums["attribute_type"];
          unit?: string | null;
          options?: string[] | null;
          is_filterable?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          code?: string;
          label?: string;
          data_type?: Enums["attribute_type"];
          unit?: string | null;
          options?: string[] | null;
          is_filterable?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attribute_definitions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          id: number;
          organization_id: string | null;
          table_name: string;
          row_id: string | null;
          action: string;
          old_data: Json | null;
          new_data: Json | null;
          actor_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          organization_id?: string | null;
          table_name: string;
          row_id?: string | null;
          action: string;
          old_data?: Json | null;
          new_data?: Json | null;
          actor_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          organization_id?: string | null;
          table_name?: string;
          row_id?: string | null;
          action?: string;
          old_data?: Json | null;
          new_data?: Json | null;
          actor_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      batch_stock: {
        Row: {
          organization_id: string;
          location_id: string;
          batch_id: string;
          on_hand: number;
          reserved: number;
        };
        Insert: {
          organization_id: string;
          location_id: string;
          batch_id: string;
          on_hand?: number;
          reserved?: number;
        };
        Update: {
          organization_id?: string;
          location_id?: string;
          batch_id?: string;
          on_hand?: number;
          reserved?: number;
        };
        Relationships: [
          {
            foreignKeyName: "batch_stock_organization_id_batch_id_fkey";
            columns: ["organization_id", "batch_id"];
            isOneToOne: false;
            referencedRelation: "batches";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "batch_stock_organization_id_location_id_fkey";
            columns: ["organization_id", "location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      batches: {
        Row: {
          id: string;
          organization_id: string;
          variant_id: string;
          lot_code: string;
          expires_on: string | null;
          manufactured_on: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          variant_id: string;
          lot_code: string;
          expires_on?: string | null;
          manufactured_on?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          variant_id?: string;
          lot_code?: string;
          expires_on?: string | null;
          manufactured_on?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "batches_organization_id_variant_id_fkey";
            columns: ["organization_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      brands: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          slug: string;
          logo_path: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          slug: string;
          logo_path?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          slug?: string;
          logo_path?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "brands_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      cart_items: {
        Row: {
          cart_id: string;
          organization_id: string;
          variant_id: string;
          quantity: number;
          added_at: string;
        };
        Insert: {
          cart_id: string;
          organization_id: string;
          variant_id: string;
          quantity: number;
          added_at?: string;
        };
        Update: {
          cart_id?: string;
          organization_id?: string;
          variant_id?: string;
          quantity?: number;
          added_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_id_fkey";
            columns: ["cart_id"];
            isOneToOne: false;
            referencedRelation: "carts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cart_items_organization_id_variant_id_fkey";
            columns: ["organization_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      carts: {
        Row: {
          id: string;
          organization_id: string;
          token_hash: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          token_hash: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          token_hash?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "carts_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          id: string;
          organization_id: string;
          parent_id: string | null;
          name: string;
          slug: string;
          description: string | null;
          position: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          parent_id?: string | null;
          name: string;
          slug: string;
          description?: string | null;
          position?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          parent_id?: string | null;
          name?: string;
          slug?: string;
          description?: string | null;
          position?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "categories_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "categories_organization_id_parent_id_fkey";
            columns: ["organization_id", "parent_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      category_attributes: {
        Row: {
          organization_id: string;
          category_id: string;
          attribute_id: string;
          position: number;
          is_required: boolean;
        };
        Insert: {
          organization_id: string;
          category_id: string;
          attribute_id: string;
          position?: number;
          is_required?: boolean;
        };
        Update: {
          organization_id?: string;
          category_id?: string;
          attribute_id?: string;
          position?: number;
          is_required?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "category_attributes_organization_id_attribute_id_fkey";
            columns: ["organization_id", "attribute_id"];
            isOneToOne: false;
            referencedRelation: "attribute_definitions";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "category_attributes_organization_id_category_id_fkey";
            columns: ["organization_id", "category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      customers: {
        Row: {
          id: string;
          organization_id: string;
          auth_user_id: string | null;
          full_name: string | null;
          phone: string | null;
          email: string | null;
          notes: string | null;
          marketing_consent: boolean;
          created_at: string;
          updated_at: string;
          store_credit_balance: number;
          loyalty_points: number;
        };
        Insert: {
          id?: string;
          organization_id: string;
          auth_user_id?: string | null;
          full_name?: string | null;
          phone?: string | null;
          email?: string | null;
          notes?: string | null;
          marketing_consent?: boolean;
          created_at?: string;
          updated_at?: string;
          store_credit_balance?: number;
          loyalty_points?: number;
        };
        Update: {
          id?: string;
          organization_id?: string;
          auth_user_id?: string | null;
          full_name?: string | null;
          phone?: string | null;
          email?: string | null;
          notes?: string | null;
          marketing_consent?: boolean;
          created_at?: string;
          updated_at?: string;
          store_credit_balance?: number;
          loyalty_points?: number;
        };
        Relationships: [
          {
            foreignKeyName: "customers_auth_user_id_fkey";
            columns: ["auth_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customers_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      document_sequences: {
        Row: {
          organization_id: string;
          doc_type: string;
          scope: string;
          prefix: string;
          next_value: number;
          pad: number;
        };
        Insert: {
          organization_id: string;
          doc_type: string;
          scope?: string;
          prefix: string;
          next_value?: number;
          pad?: number;
        };
        Update: {
          organization_id?: string;
          doc_type?: string;
          scope?: string;
          prefix?: string;
          next_value?: number;
          pad?: number;
        };
        Relationships: [
          {
            foreignKeyName: "document_sequences_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      gift_card_ledger: {
        Row: {
          id: number;
          organization_id: string;
          gift_card_id: string;
          amount: number;
          reason: string;
          order_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          organization_id: string;
          gift_card_id: string;
          amount: number;
          reason: string;
          order_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          organization_id?: string;
          gift_card_id?: string;
          amount?: number;
          reason?: string;
          order_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "gift_card_ledger_organization_id_gift_card_id_fkey";
            columns: ["organization_id", "gift_card_id"];
            isOneToOne: false;
            referencedRelation: "gift_cards";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      gift_cards: {
        Row: {
          id: string;
          organization_id: string;
          code: string;
          initial_value: number;
          balance: number;
          status: string;
          expires_on: string | null;
          customer_id: string | null;
          order_line_id: string | null;
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          code: string;
          initial_value: number;
          balance?: number;
          status?: string;
          expires_on?: string | null;
          customer_id?: string | null;
          order_line_id?: string | null;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          code?: string;
          initial_value?: number;
          balance?: number;
          status?: string;
          expires_on?: string | null;
          customer_id?: string | null;
          order_line_id?: string | null;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "gift_cards_organization_id_customer_id_fkey";
            columns: ["organization_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "gift_cards_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gift_cards_organization_id_order_line_id_fkey";
            columns: ["organization_id", "order_line_id"];
            isOneToOne: false;
            referencedRelation: "order_lines";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      inventory_movements: {
        Row: {
          id: number;
          organization_id: string;
          location_id: string;
          variant_id: string;
          batch_id: string | null;
          serial_unit_id: string | null;
          movement_type: Enums["movement_type"];
          quantity: number;
          unit_cost: number | null;
          source_type: string;
          source_id: string | null;
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          organization_id: string;
          location_id: string;
          variant_id: string;
          batch_id?: string | null;
          serial_unit_id?: string | null;
          movement_type: Enums["movement_type"];
          quantity: number;
          unit_cost?: number | null;
          source_type: string;
          source_id?: string | null;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          organization_id?: string;
          location_id?: string;
          variant_id?: string;
          batch_id?: string | null;
          serial_unit_id?: string | null;
          movement_type?: Enums["movement_type"];
          quantity?: number;
          unit_cost?: number | null;
          source_type?: string;
          source_id?: string | null;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_movements_organization_id_batch_id_fkey";
            columns: ["organization_id", "batch_id"];
            isOneToOne: false;
            referencedRelation: "batches";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "inventory_movements_organization_id_location_id_fkey";
            columns: ["organization_id", "location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "inventory_movements_organization_id_serial_unit_id_fkey";
            columns: ["organization_id", "serial_unit_id"];
            isOneToOne: false;
            referencedRelation: "serial_units";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "inventory_movements_organization_id_variant_id_fkey";
            columns: ["organization_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      locations: {
        Row: {
          id: string;
          organization_id: string;
          code: string;
          name: string;
          kind: Enums["location_kind"];
          sells_online: boolean;
          fulfilment_priority: number;
          is_active: boolean;
          address: Json;
          phone: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          code: string;
          name: string;
          kind?: Enums["location_kind"];
          sells_online?: boolean;
          fulfilment_priority?: number;
          is_active?: boolean;
          address?: Json;
          phone?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          code?: string;
          name?: string;
          kind?: Enums["location_kind"];
          sells_online?: boolean;
          fulfilment_priority?: number;
          is_active?: boolean;
          address?: Json;
          phone?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "locations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      loyalty_ledger: {
        Row: {
          id: number;
          organization_id: string;
          customer_id: string;
          points: number;
          reason: string;
          source_type: string;
          source_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          organization_id: string;
          customer_id: string;
          points: number;
          reason: string;
          source_type: string;
          source_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          organization_id?: string;
          customer_id?: string;
          points?: number;
          reason?: string;
          source_type?: string;
          source_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "loyalty_ledger_organization_id_customer_id_fkey";
            columns: ["organization_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      memberships: {
        Row: {
          organization_id: string;
          user_id: string;
          role: Enums["staff_role"];
          location_ids: string[] | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          user_id: string;
          role: Enums["staff_role"];
          location_ids?: string[] | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          organization_id?: string;
          user_id?: string;
          role?: Enums["staff_role"];
          location_ids?: string[] | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memberships_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      order_line_units: {
        Row: {
          organization_id: string;
          order_line_id: string;
          serial_unit_id: string;
        };
        Insert: {
          organization_id: string;
          order_line_id: string;
          serial_unit_id: string;
        };
        Update: {
          organization_id?: string;
          order_line_id?: string;
          serial_unit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_line_units_organization_id_order_line_id_fkey";
            columns: ["organization_id", "order_line_id"];
            isOneToOne: false;
            referencedRelation: "order_lines";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "order_line_units_organization_id_serial_unit_id_fkey";
            columns: ["organization_id", "serial_unit_id"];
            isOneToOne: false;
            referencedRelation: "serial_units";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      order_lines: {
        Row: {
          id: string;
          organization_id: string;
          order_id: string;
          variant_id: string;
          product_name: string;
          variant_title: string;
          sku: string | null;
          lot_code: string | null;
          quantity: number;
          unit_price: number;
          line_total: number;
          position: number;
          line_subtotal: number;
          discount_amount: number;
          tax_rate: number;
          tax_amount: number;
          warranty_months: number | null;
          promo_discount: number;
        };
        Insert: {
          id?: string;
          organization_id: string;
          order_id: string;
          variant_id: string;
          product_name: string;
          variant_title: string;
          sku?: string | null;
          lot_code?: string | null;
          quantity: number;
          unit_price: number;
          line_total: number;
          position?: number;
          line_subtotal: number;
          discount_amount?: number;
          tax_rate?: number;
          tax_amount?: number;
          warranty_months?: number | null;
          promo_discount?: number;
        };
        Update: {
          id?: string;
          organization_id?: string;
          order_id?: string;
          variant_id?: string;
          product_name?: string;
          variant_title?: string;
          sku?: string | null;
          lot_code?: string | null;
          quantity?: number;
          unit_price?: number;
          line_total?: number;
          position?: number;
          line_subtotal?: number;
          discount_amount?: number;
          tax_rate?: number;
          tax_amount?: number;
          warranty_months?: number | null;
          promo_discount?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_lines_organization_id_order_id_fkey";
            columns: ["organization_id", "order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "order_lines_organization_id_variant_id_fkey";
            columns: ["organization_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      order_promotions: {
        Row: {
          organization_id: string;
          order_id: string;
          promotion_id: string;
          amount: number;
        };
        Insert: {
          organization_id: string;
          order_id: string;
          promotion_id: string;
          amount: number;
        };
        Update: {
          organization_id?: string;
          order_id?: string;
          promotion_id?: string;
          amount?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_promotions_organization_id_order_id_fkey";
            columns: ["organization_id", "order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "order_promotions_organization_id_promotion_id_fkey";
            columns: ["organization_id", "promotion_id"];
            isOneToOne: false;
            referencedRelation: "promotions";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      orders: {
        Row: {
          id: string;
          organization_id: string;
          number: string;
          channel: Enums["sales_channel"];
          location_id: string;
          customer_id: string | null;
          status: Enums["order_status"];
          currency_code: string;
          subtotal: number;
          discount_total: number;
          tax_total: number;
          total: number;
          idempotency_key: string | null;
          reservation_expires_at: string | null;
          note: string | null;
          placed_by: string | null;
          placed_at: string;
          confirmed_at: string | null;
          cancelled_at: string | null;
          updated_at: string;
          tax_inclusive: boolean;
          amount_paid: number;
          amount_refunded: number;
          payment_status: Enums["payment_state"];
          fulfilment_method: Enums["fulfilment_method"];
          contact: Json;
          shipping_address: Json | null;
          shipping_total: number;
          intended_payment_method: Enums["payment_method"] | null;
          access_token: string;
          terminal_id: string | null;
          shift_id: string | null;
          coupon_code: string | null;
          promo_discount_total: number;
        };
        Insert: {
          id?: string;
          organization_id: string;
          number: string;
          channel: Enums["sales_channel"];
          location_id: string;
          customer_id?: string | null;
          status: Enums["order_status"];
          currency_code: string;
          subtotal?: number;
          discount_total?: number;
          tax_total?: number;
          total?: number;
          idempotency_key?: string | null;
          reservation_expires_at?: string | null;
          note?: string | null;
          placed_by?: string | null;
          placed_at?: string;
          confirmed_at?: string | null;
          cancelled_at?: string | null;
          updated_at?: string;
          tax_inclusive?: boolean;
          amount_paid?: number;
          amount_refunded?: number;
          payment_status?: Enums["payment_state"];
          fulfilment_method?: Enums["fulfilment_method"];
          contact?: Json;
          shipping_address?: Json | null;
          shipping_total?: number;
          intended_payment_method?: Enums["payment_method"] | null;
          access_token?: string;
          terminal_id?: string | null;
          shift_id?: string | null;
          coupon_code?: string | null;
          promo_discount_total?: number;
        };
        Update: {
          id?: string;
          organization_id?: string;
          number?: string;
          channel?: Enums["sales_channel"];
          location_id?: string;
          customer_id?: string | null;
          status?: Enums["order_status"];
          currency_code?: string;
          subtotal?: number;
          discount_total?: number;
          tax_total?: number;
          total?: number;
          idempotency_key?: string | null;
          reservation_expires_at?: string | null;
          note?: string | null;
          placed_by?: string | null;
          placed_at?: string;
          confirmed_at?: string | null;
          cancelled_at?: string | null;
          updated_at?: string;
          tax_inclusive?: boolean;
          amount_paid?: number;
          amount_refunded?: number;
          payment_status?: Enums["payment_state"];
          fulfilment_method?: Enums["fulfilment_method"];
          contact?: Json;
          shipping_address?: Json | null;
          shipping_total?: number;
          intended_payment_method?: Enums["payment_method"] | null;
          access_token?: string;
          terminal_id?: string | null;
          shift_id?: string | null;
          coupon_code?: string | null;
          promo_discount_total?: number;
        };
        Relationships: [
          {
            foreignKeyName: "orders_organization_id_customer_id_fkey";
            columns: ["organization_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "orders_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_organization_id_location_id_fkey";
            columns: ["organization_id", "location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "orders_organization_id_shift_id_fkey";
            columns: ["organization_id", "shift_id"];
            isOneToOne: false;
            referencedRelation: "pos_shifts";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "orders_organization_id_terminal_id_fkey";
            columns: ["organization_id", "terminal_id"];
            isOneToOne: false;
            referencedRelation: "pos_terminals";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      organization_modules: {
        Row: {
          organization_id: string;
          module: Enums["module_key"];
          enabled: boolean;
          changed_at: string;
        };
        Insert: {
          organization_id: string;
          module: Enums["module_key"];
          enabled?: boolean;
          changed_at?: string;
        };
        Update: {
          organization_id?: string;
          module?: Enums["module_key"];
          enabled?: boolean;
          changed_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_modules_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          currency_code: string;
          timezone: string;
          settings: Json;
          created_at: string;
          updated_at: string;
          prices_include_tax: boolean;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          currency_code?: string;
          timezone?: string;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
          prices_include_tax?: boolean;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          currency_code?: string;
          timezone?: string;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
          prices_include_tax?: boolean;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          organization_id: string;
          order_id: string;
          kind: Enums["payment_kind"];
          method: Enums["payment_method"];
          status: Enums["payment_status"];
          amount: number;
          tendered: number | null;
          change_given: number | null;
          provider: string | null;
          provider_reference: string | null;
          payload: Json;
          note: string | null;
          created_by: string | null;
          created_at: string;
          captured_at: string | null;
          shift_id: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          order_id: string;
          kind?: Enums["payment_kind"];
          method: Enums["payment_method"];
          status?: Enums["payment_status"];
          amount: number;
          tendered?: number | null;
          change_given?: number | null;
          provider?: string | null;
          provider_reference?: string | null;
          payload?: Json;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
          captured_at?: string | null;
          shift_id?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          order_id?: string;
          kind?: Enums["payment_kind"];
          method?: Enums["payment_method"];
          status?: Enums["payment_status"];
          amount?: number;
          tendered?: number | null;
          change_given?: number | null;
          provider?: string | null;
          provider_reference?: string | null;
          payload?: Json;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
          captured_at?: string | null;
          shift_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payments_organization_id_order_id_fkey";
            columns: ["organization_id", "order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "payments_organization_id_shift_id_fkey";
            columns: ["organization_id", "shift_id"];
            isOneToOne: false;
            referencedRelation: "pos_shifts";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      plans: {
        Row: {
          code: string;
          name: string;
          modules: Enums["module_key"][];
          position: number;
        };
        Insert: {
          code: string;
          name: string;
          modules: Enums["module_key"][];
          position?: number;
        };
        Update: {
          code?: string;
          name?: string;
          modules?: Enums["module_key"][];
          position?: number;
        };
        Relationships: [];
      };
      pos_cash_movements: {
        Row: {
          id: number;
          organization_id: string;
          shift_id: string;
          kind: Enums["cash_movement_kind"];
          amount: number;
          reason: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          organization_id: string;
          shift_id: string;
          kind: Enums["cash_movement_kind"];
          amount: number;
          reason: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          organization_id?: string;
          shift_id?: string;
          kind?: Enums["cash_movement_kind"];
          amount?: number;
          reason?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pos_cash_movements_organization_id_shift_id_fkey";
            columns: ["organization_id", "shift_id"];
            isOneToOne: false;
            referencedRelation: "pos_shifts";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      pos_held_sales: {
        Row: {
          id: string;
          organization_id: string;
          terminal_id: string;
          label: string | null;
          lines: Json;
          customer_id: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          terminal_id: string;
          label?: string | null;
          lines: Json;
          customer_id?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          terminal_id?: string;
          label?: string | null;
          lines?: Json;
          customer_id?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pos_held_sales_organization_id_customer_id_fkey";
            columns: ["organization_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "pos_held_sales_organization_id_terminal_id_fkey";
            columns: ["organization_id", "terminal_id"];
            isOneToOne: false;
            referencedRelation: "pos_terminals";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      pos_shifts: {
        Row: {
          id: string;
          organization_id: string;
          terminal_id: string;
          location_id: string;
          number: string;
          status: Enums["shift_status"];
          opened_by: string;
          opened_at: string;
          opening_float: number;
          closed_by: string | null;
          closed_at: string | null;
          expected_cash: number | null;
          counted_cash: number | null;
          variance: number | null;
          close_note: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          terminal_id: string;
          location_id: string;
          number: string;
          status?: Enums["shift_status"];
          opened_by?: string;
          opened_at?: string;
          opening_float: number;
          closed_by?: string | null;
          closed_at?: string | null;
          expected_cash?: number | null;
          counted_cash?: number | null;
          variance?: number | null;
          close_note?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          terminal_id?: string;
          location_id?: string;
          number?: string;
          status?: Enums["shift_status"];
          opened_by?: string;
          opened_at?: string;
          opening_float?: number;
          closed_by?: string | null;
          closed_at?: string | null;
          expected_cash?: number | null;
          counted_cash?: number | null;
          variance?: number | null;
          close_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "pos_shifts_organization_id_location_id_fkey";
            columns: ["organization_id", "location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "pos_shifts_organization_id_terminal_id_fkey";
            columns: ["organization_id", "terminal_id"];
            isOneToOne: false;
            referencedRelation: "pos_terminals";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      pos_terminals: {
        Row: {
          id: string;
          organization_id: string;
          location_id: string;
          code: string;
          name: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          location_id: string;
          code: string;
          name: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          location_id?: string;
          code?: string;
          name?: string;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pos_terminals_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pos_terminals_organization_id_location_id_fkey";
            columns: ["organization_id", "location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      product_attribute_values: {
        Row: {
          organization_id: string;
          product_id: string;
          attribute_id: string;
          value: Json;
        };
        Insert: {
          organization_id: string;
          product_id: string;
          attribute_id: string;
          value: Json;
        };
        Update: {
          organization_id?: string;
          product_id?: string;
          attribute_id?: string;
          value?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "product_attribute_values_organization_id_attribute_id_fkey";
            columns: ["organization_id", "attribute_id"];
            isOneToOne: false;
            referencedRelation: "attribute_definitions";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "product_attribute_values_organization_id_product_id_fkey";
            columns: ["organization_id", "product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      product_media: {
        Row: {
          id: string;
          organization_id: string;
          product_id: string;
          variant_id: string | null;
          storage_path: string;
          alt_text: string | null;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          product_id: string;
          variant_id?: string | null;
          storage_path: string;
          alt_text?: string | null;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          product_id?: string;
          variant_id?: string | null;
          storage_path?: string;
          alt_text?: string | null;
          position?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_media_organization_id_product_id_fkey";
            columns: ["organization_id", "product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "product_media_organization_id_variant_id_fkey";
            columns: ["organization_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      product_option_values: {
        Row: {
          id: string;
          organization_id: string;
          option_id: string;
          value: string;
          position: number;
        };
        Insert: {
          id?: string;
          organization_id: string;
          option_id: string;
          value: string;
          position?: number;
        };
        Update: {
          id?: string;
          organization_id?: string;
          option_id?: string;
          value?: string;
          position?: number;
        };
        Relationships: [
          {
            foreignKeyName: "product_option_values_organization_id_option_id_fkey";
            columns: ["organization_id", "option_id"];
            isOneToOne: false;
            referencedRelation: "product_options";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      product_options: {
        Row: {
          id: string;
          organization_id: string;
          product_id: string;
          name: string;
          position: number;
        };
        Insert: {
          id?: string;
          organization_id: string;
          product_id: string;
          name: string;
          position?: number;
        };
        Update: {
          id?: string;
          organization_id?: string;
          product_id?: string;
          name?: string;
          position?: number;
        };
        Relationships: [
          {
            foreignKeyName: "product_options_organization_id_product_id_fkey";
            columns: ["organization_id", "product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      product_variants: {
        Row: {
          id: string;
          organization_id: string;
          product_id: string;
          title: string;
          sku: string | null;
          barcode: string | null;
          price: number;
          compare_at_price: number | null;
          position: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          product_id: string;
          title?: string;
          sku?: string | null;
          barcode?: string | null;
          price: number;
          compare_at_price?: number | null;
          position?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          product_id?: string;
          title?: string;
          sku?: string | null;
          barcode?: string | null;
          price?: number;
          compare_at_price?: number | null;
          position?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_variants_organization_id_product_id_fkey";
            columns: ["organization_id", "product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      products: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          slug: string;
          brand_id: string | null;
          category_id: string | null;
          summary: string | null;
          description: string | null;
          status: Enums["product_status"];
          tracking_mode: Enums["tracking_mode"];
          unit_of_measure: string;
          allow_fractional: boolean;
          seo: Json;
          created_at: string;
          updated_at: string;
          tax_rate_id: string | null;
          tax_exempt: boolean;
          warranty_months: number | null;
          warranty_terms: string | null;
          is_gift_card: boolean;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          slug: string;
          brand_id?: string | null;
          category_id?: string | null;
          summary?: string | null;
          description?: string | null;
          status?: Enums["product_status"];
          tracking_mode?: Enums["tracking_mode"];
          unit_of_measure?: string;
          allow_fractional?: boolean;
          seo?: Json;
          created_at?: string;
          updated_at?: string;
          tax_rate_id?: string | null;
          tax_exempt?: boolean;
          warranty_months?: number | null;
          warranty_terms?: string | null;
          is_gift_card?: boolean;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          slug?: string;
          brand_id?: string | null;
          category_id?: string | null;
          summary?: string | null;
          description?: string | null;
          status?: Enums["product_status"];
          tracking_mode?: Enums["tracking_mode"];
          unit_of_measure?: string;
          allow_fractional?: boolean;
          seo?: Json;
          created_at?: string;
          updated_at?: string;
          tax_rate_id?: string | null;
          tax_exempt?: boolean;
          warranty_months?: number | null;
          warranty_terms?: string | null;
          is_gift_card?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "products_organization_id_brand_id_fkey";
            columns: ["organization_id", "brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "products_organization_id_category_id_fkey";
            columns: ["organization_id", "category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "products_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_organization_id_tax_rate_id_fkey";
            columns: ["organization_id", "tax_rate_id"];
            isOneToOne: false;
            referencedRelation: "tax_rates";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      promotions: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          kind: Enums["promotion_kind"];
          scope: Enums["promotion_scope"];
          value: number;
          buy_quantity: number | null;
          get_quantity: number | null;
          min_subtotal: number | null;
          product_ids: string[];
          category_ids: string[];
          brand_ids: string[];
          coupon_code: string | null;
          channels: Enums["sales_channel"][] | null;
          starts_at: string | null;
          ends_at: string | null;
          usage_limit: number | null;
          usage_count: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          kind: Enums["promotion_kind"];
          scope: Enums["promotion_scope"];
          value?: number;
          buy_quantity?: number | null;
          get_quantity?: number | null;
          min_subtotal?: number | null;
          product_ids?: string[];
          category_ids?: string[];
          brand_ids?: string[];
          coupon_code?: string | null;
          channels?: Enums["sales_channel"][] | null;
          starts_at?: string | null;
          ends_at?: string | null;
          usage_limit?: number | null;
          usage_count?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          kind?: Enums["promotion_kind"];
          scope?: Enums["promotion_scope"];
          value?: number;
          buy_quantity?: number | null;
          get_quantity?: number | null;
          min_subtotal?: number | null;
          product_ids?: string[];
          category_ids?: string[];
          brand_ids?: string[];
          coupon_code?: string | null;
          channels?: Enums["sales_channel"][] | null;
          starts_at?: string | null;
          ends_at?: string | null;
          usage_limit?: number | null;
          usage_count?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "promotions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_order_lines: {
        Row: {
          id: string;
          organization_id: string;
          purchase_order_id: string;
          variant_id: string;
          quantity_ordered: number;
          quantity_received: number;
          unit_cost: number;
          position: number;
        };
        Insert: {
          id?: string;
          organization_id: string;
          purchase_order_id: string;
          variant_id: string;
          quantity_ordered: number;
          quantity_received?: number;
          unit_cost: number;
          position?: number;
        };
        Update: {
          id?: string;
          organization_id?: string;
          purchase_order_id?: string;
          variant_id?: string;
          quantity_ordered?: number;
          quantity_received?: number;
          unit_cost?: number;
          position?: number;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_organization_id_purchase_order_id_fkey";
            columns: ["organization_id", "purchase_order_id"];
            isOneToOne: false;
            referencedRelation: "purchase_orders";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "purchase_order_lines_organization_id_variant_id_fkey";
            columns: ["organization_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      purchase_orders: {
        Row: {
          id: string;
          organization_id: string;
          number: string;
          supplier_id: string;
          location_id: string;
          status: Enums["po_status"];
          expected_on: string | null;
          supplier_reference: string | null;
          note: string | null;
          total: number;
          created_by: string | null;
          created_at: string;
          ordered_at: string | null;
          closed_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          number: string;
          supplier_id: string;
          location_id: string;
          status?: Enums["po_status"];
          expected_on?: string | null;
          supplier_reference?: string | null;
          note?: string | null;
          total?: number;
          created_by?: string | null;
          created_at?: string;
          ordered_at?: string | null;
          closed_at?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          number?: string;
          supplier_id?: string;
          location_id?: string;
          status?: Enums["po_status"];
          expected_on?: string | null;
          supplier_reference?: string | null;
          note?: string | null;
          total?: number;
          created_by?: string | null;
          created_at?: string;
          ordered_at?: string | null;
          closed_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_orders_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_orders_organization_id_location_id_fkey";
            columns: ["organization_id", "location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "purchase_orders_organization_id_supplier_id_fkey";
            columns: ["organization_id", "supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      race_ctx: {
        Row: {
          key: string;
          id: string | null;
        };
        Insert: {
          key: string;
          id?: string | null;
        };
        Update: {
          key?: string;
          id?: string | null;
        };
        Relationships: [];
      };
      return_lines: {
        Row: {
          id: string;
          organization_id: string;
          return_id: string;
          order_line_id: string;
          variant_id: string;
          quantity: number;
          serial_unit_id: string | null;
          batch_id: string | null;
          line_refund: number;
          unit_cost: number | null;
          reason: string | null;
          disposition: Enums["return_disposition"];
          inspected_by: string | null;
          inspected_at: string | null;
          inspection_note: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          return_id: string;
          order_line_id: string;
          variant_id: string;
          quantity: number;
          serial_unit_id?: string | null;
          batch_id?: string | null;
          line_refund: number;
          unit_cost?: number | null;
          reason?: string | null;
          disposition?: Enums["return_disposition"];
          inspected_by?: string | null;
          inspected_at?: string | null;
          inspection_note?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          return_id?: string;
          order_line_id?: string;
          variant_id?: string;
          quantity?: number;
          serial_unit_id?: string | null;
          batch_id?: string | null;
          line_refund?: number;
          unit_cost?: number | null;
          reason?: string | null;
          disposition?: Enums["return_disposition"];
          inspected_by?: string | null;
          inspected_at?: string | null;
          inspection_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "return_lines_organization_id_batch_id_fkey";
            columns: ["organization_id", "batch_id"];
            isOneToOne: false;
            referencedRelation: "batches";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "return_lines_organization_id_order_line_id_fkey";
            columns: ["organization_id", "order_line_id"];
            isOneToOne: false;
            referencedRelation: "order_lines";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "return_lines_organization_id_return_id_fkey";
            columns: ["organization_id", "return_id"];
            isOneToOne: false;
            referencedRelation: "returns";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "return_lines_organization_id_serial_unit_id_fkey";
            columns: ["organization_id", "serial_unit_id"];
            isOneToOne: false;
            referencedRelation: "serial_units";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "return_lines_organization_id_variant_id_fkey";
            columns: ["organization_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      returns: {
        Row: {
          id: string;
          organization_id: string;
          number: string;
          order_id: string;
          status: Enums["return_status"];
          channel: Enums["sales_channel"];
          location_id: string | null;
          customer_id: string | null;
          shift_id: string | null;
          reason: string | null;
          refund_total: number;
          idempotency_key: string | null;
          requested_at: string;
          received_at: string | null;
          received_by: string | null;
          created_by: string | null;
          exchange_order_id: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          number: string;
          order_id: string;
          status: Enums["return_status"];
          channel: Enums["sales_channel"];
          location_id?: string | null;
          customer_id?: string | null;
          shift_id?: string | null;
          reason?: string | null;
          refund_total?: number;
          idempotency_key?: string | null;
          requested_at?: string;
          received_at?: string | null;
          received_by?: string | null;
          created_by?: string | null;
          exchange_order_id?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          number?: string;
          order_id?: string;
          status?: Enums["return_status"];
          channel?: Enums["sales_channel"];
          location_id?: string | null;
          customer_id?: string | null;
          shift_id?: string | null;
          reason?: string | null;
          refund_total?: number;
          idempotency_key?: string | null;
          requested_at?: string;
          received_at?: string | null;
          received_by?: string | null;
          created_by?: string | null;
          exchange_order_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "returns_organization_id_customer_id_fkey";
            columns: ["organization_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "returns_organization_id_exchange_order_id_fkey";
            columns: ["organization_id", "exchange_order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "returns_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "returns_organization_id_location_id_fkey";
            columns: ["organization_id", "location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "returns_organization_id_order_id_fkey";
            columns: ["organization_id", "order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "returns_organization_id_shift_id_fkey";
            columns: ["organization_id", "shift_id"];
            isOneToOne: false;
            referencedRelation: "pos_shifts";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      serial_units: {
        Row: {
          id: string;
          organization_id: string;
          variant_id: string;
          serial: string;
          status: Enums["serial_status"];
          location_id: string | null;
          unit_cost: number | null;
          received_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          variant_id: string;
          serial: string;
          status?: Enums["serial_status"];
          location_id?: string | null;
          unit_cost?: number | null;
          received_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          variant_id?: string;
          serial?: string;
          status?: Enums["serial_status"];
          location_id?: string | null;
          unit_cost?: number | null;
          received_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "serial_units_organization_id_location_id_fkey";
            columns: ["organization_id", "location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "serial_units_organization_id_variant_id_fkey";
            columns: ["organization_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      staff_pins: {
        Row: {
          organization_id: string;
          user_id: string;
          pin_hash: string;
          failed_attempts: number;
          locked_until: string | null;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          user_id: string;
          pin_hash: string;
          failed_attempts?: number;
          locked_until?: string | null;
          updated_at?: string;
        };
        Update: {
          organization_id?: string;
          user_id?: string;
          pin_hash?: string;
          failed_attempts?: number;
          locked_until?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_pins_organization_id_user_id_fkey";
            columns: ["organization_id", "user_id"];
            isOneToOne: true;
            referencedRelation: "memberships";
            referencedColumns: ["organization_id", "user_id"];
          },
        ];
      };
      stock_levels: {
        Row: {
          organization_id: string;
          location_id: string;
          variant_id: string;
          on_hand: number;
          reserved: number;
          avg_unit_cost: number;
          low_stock_threshold: number | null;
          updated_at: string;
        };
        Insert: {
          organization_id: string;
          location_id: string;
          variant_id: string;
          on_hand?: number;
          reserved?: number;
          avg_unit_cost?: number;
          low_stock_threshold?: number | null;
          updated_at?: string;
        };
        Update: {
          organization_id?: string;
          location_id?: string;
          variant_id?: string;
          on_hand?: number;
          reserved?: number;
          avg_unit_cost?: number;
          low_stock_threshold?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_levels_organization_id_location_id_fkey";
            columns: ["organization_id", "location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "stock_levels_organization_id_variant_id_fkey";
            columns: ["organization_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      stock_receipts: {
        Row: {
          id: string;
          organization_id: string;
          location_id: string;
          number: string;
          reference: string | null;
          note: string | null;
          created_by: string | null;
          created_at: string;
          purchase_order_id: string | null;
          supplier_id: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          location_id: string;
          number: string;
          reference?: string | null;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
          purchase_order_id?: string | null;
          supplier_id?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          location_id?: string;
          number?: string;
          reference?: string | null;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
          purchase_order_id?: string | null;
          supplier_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "stock_receipts_organization_id_location_id_fkey";
            columns: ["organization_id", "location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "stock_receipts_organization_id_purchase_order_id_fkey";
            columns: ["organization_id", "purchase_order_id"];
            isOneToOne: false;
            referencedRelation: "purchase_orders";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "stock_receipts_organization_id_supplier_id_fkey";
            columns: ["organization_id", "supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      stock_reservations: {
        Row: {
          id: string;
          organization_id: string;
          location_id: string;
          variant_id: string;
          batch_id: string | null;
          serial_unit_id: string | null;
          quantity: number;
          status: Enums["reservation_status"];
          expires_at: string | null;
          source_type: string;
          source_id: string;
          created_at: string;
          closed_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          location_id: string;
          variant_id: string;
          batch_id?: string | null;
          serial_unit_id?: string | null;
          quantity: number;
          status?: Enums["reservation_status"];
          expires_at?: string | null;
          source_type: string;
          source_id: string;
          created_at?: string;
          closed_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          location_id?: string;
          variant_id?: string;
          batch_id?: string | null;
          serial_unit_id?: string | null;
          quantity?: number;
          status?: Enums["reservation_status"];
          expires_at?: string | null;
          source_type?: string;
          source_id?: string;
          created_at?: string;
          closed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "stock_reservations_organization_id_batch_id_fkey";
            columns: ["organization_id", "batch_id"];
            isOneToOne: false;
            referencedRelation: "batches";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "stock_reservations_organization_id_location_id_fkey";
            columns: ["organization_id", "location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "stock_reservations_organization_id_serial_unit_id_fkey";
            columns: ["organization_id", "serial_unit_id"];
            isOneToOne: false;
            referencedRelation: "serial_units";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "stock_reservations_organization_id_variant_id_fkey";
            columns: ["organization_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      stock_transfer_lines: {
        Row: {
          id: string;
          organization_id: string;
          transfer_id: string;
          variant_id: string;
          quantity: number;
          serials: string[] | null;
          quantity_received: number | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          transfer_id: string;
          variant_id: string;
          quantity: number;
          serials?: string[] | null;
          quantity_received?: number | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          transfer_id?: string;
          variant_id?: string;
          quantity?: number;
          serials?: string[] | null;
          quantity_received?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "stock_transfer_lines_organization_id_transfer_id_fkey";
            columns: ["organization_id", "transfer_id"];
            isOneToOne: false;
            referencedRelation: "stock_transfers";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "stock_transfer_lines_organization_id_variant_id_fkey";
            columns: ["organization_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      stock_transfers: {
        Row: {
          id: string;
          organization_id: string;
          number: string;
          from_location_id: string;
          to_location_id: string;
          status: Enums["transfer_status"];
          note: string | null;
          requested_by: string | null;
          requested_at: string;
          approved_by: string | null;
          approved_at: string | null;
          dispatched_by: string | null;
          dispatched_at: string | null;
          received_by: string | null;
          received_at: string | null;
          receive_note: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          number: string;
          from_location_id: string;
          to_location_id: string;
          status?: Enums["transfer_status"];
          note?: string | null;
          requested_by?: string | null;
          requested_at?: string;
          approved_by?: string | null;
          approved_at?: string | null;
          dispatched_by?: string | null;
          dispatched_at?: string | null;
          received_by?: string | null;
          received_at?: string | null;
          receive_note?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          number?: string;
          from_location_id?: string;
          to_location_id?: string;
          status?: Enums["transfer_status"];
          note?: string | null;
          requested_by?: string | null;
          requested_at?: string;
          approved_by?: string | null;
          approved_at?: string | null;
          dispatched_by?: string | null;
          dispatched_at?: string | null;
          received_by?: string | null;
          received_at?: string | null;
          receive_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "stock_transfers_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_transfers_organization_id_from_location_id_fkey";
            columns: ["organization_id", "from_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "stock_transfers_organization_id_to_location_id_fkey";
            columns: ["organization_id", "to_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      store_credit_ledger: {
        Row: {
          id: number;
          organization_id: string;
          customer_id: string;
          amount: number;
          reason: string;
          source_type: string;
          source_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          organization_id: string;
          customer_id: string;
          amount: number;
          reason: string;
          source_type: string;
          source_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          organization_id?: string;
          customer_id?: string;
          amount?: number;
          reason?: string;
          source_type?: string;
          source_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "store_credit_ledger_organization_id_customer_id_fkey";
            columns: ["organization_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      suppliers: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          contact_name: string | null;
          phone: string | null;
          email: string | null;
          address: Json;
          payment_terms_days: number | null;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          contact_name?: string | null;
          phone?: string | null;
          email?: string | null;
          address?: Json;
          payment_terms_days?: number | null;
          notes?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          contact_name?: string | null;
          phone?: string | null;
          email?: string | null;
          address?: Json;
          payment_terms_days?: number | null;
          notes?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "suppliers_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      tax_rates: {
        Row: {
          id: string;
          organization_id: string;
          code: string;
          name: string;
          rate_percent: number;
          is_default: boolean;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          code: string;
          name: string;
          rate_percent: number;
          is_default?: boolean;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          code?: string;
          name?: string;
          rate_percent?: number;
          is_default?: boolean;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tax_rates_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      variant_option_values: {
        Row: {
          organization_id: string;
          variant_id: string;
          option_value_id: string;
        };
        Insert: {
          organization_id: string;
          variant_id: string;
          option_value_id: string;
        };
        Update: {
          organization_id?: string;
          variant_id?: string;
          option_value_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "variant_option_values_organization_id_option_value_id_fkey";
            columns: ["organization_id", "option_value_id"];
            isOneToOne: false;
            referencedRelation: "product_option_values";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "variant_option_values_organization_id_variant_id_fkey";
            columns: ["organization_id", "variant_id"];
            isOneToOne: false;
            referencedRelation: "product_variants";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      warranty_claim_events: {
        Row: {
          id: number;
          organization_id: string;
          claim_id: string;
          status: Enums["warranty_claim_status"];
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          organization_id: string;
          claim_id: string;
          status: Enums["warranty_claim_status"];
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          organization_id?: string;
          claim_id?: string;
          status?: Enums["warranty_claim_status"];
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "warranty_claim_events_organization_id_claim_id_fkey";
            columns: ["organization_id", "claim_id"];
            isOneToOne: false;
            referencedRelation: "warranty_claims";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      warranty_claims: {
        Row: {
          id: string;
          organization_id: string;
          number: string;
          order_line_id: string;
          serial_unit_id: string | null;
          customer_id: string | null;
          status: Enums["warranty_claim_status"];
          issue: string;
          within_warranty: boolean;
          expires_on: string | null;
          resolution: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          number: string;
          order_line_id: string;
          serial_unit_id?: string | null;
          customer_id?: string | null;
          status?: Enums["warranty_claim_status"];
          issue: string;
          within_warranty: boolean;
          expires_on?: string | null;
          resolution?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          number?: string;
          order_line_id?: string;
          serial_unit_id?: string | null;
          customer_id?: string | null;
          status?: Enums["warranty_claim_status"];
          issue?: string;
          within_warranty?: boolean;
          expires_on?: string | null;
          resolution?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "warranty_claims_organization_id_customer_id_fkey";
            columns: ["organization_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "warranty_claims_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "warranty_claims_organization_id_order_line_id_fkey";
            columns: ["organization_id", "order_line_id"];
            isOneToOne: false;
            referencedRelation: "order_lines";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "warranty_claims_organization_id_serial_unit_id_fkey";
            columns: ["organization_id", "serial_unit_id"];
            isOneToOne: false;
            referencedRelation: "serial_units";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
    };
    Views: {
    };
    Functions: {
      add_staff_by_email: {
        Args: {
          p_organization_id: string | null;
          p_email: string | null;
          p_role: Enums["staff_role"] | null;
          p_location_ids?: string[] | null;
        };
        Returns: string;
      };
      adjust_loyalty_points: {
        Args: {
          p_customer_id: string | null;
          p_points: number | null;
          p_reason: string | null;
        };
        Returns: number;
      };
      adjust_stock: {
        Args: {
          p_location_id: string | null;
          p_variant_id: string | null;
          p_quantity: number | null;
          p_reason: Enums["movement_type"] | null;
          p_note: string | null;
          p_serials?: string[] | null;
          p_lot_code?: string | null;
          p_expires_on?: string | null;
          p_unit_cost?: number | null;
        };
        Returns: Json;
      };
      adjust_store_credit: {
        Args: {
          p_customer_id: string | null;
          p_amount: number | null;
          p_reason: string | null;
        };
        Returns: number;
      };
      apply_plan: {
        Args: {
          p_organization_id: string | null;
          p_plan: string | null;
        };
        Returns: undefined;
      };
      approve_transfer: {
        Args: {
          p_transfer_id: string | null;
        };
        Returns: undefined;
      };
      assert_location_access: {
        Args: {
          p_org: string | null;
          p_location: string | null;
        };
        Returns: undefined;
      };
      assert_module: {
        Args: {
          p_org: string | null;
          p_module: Enums["module_key"] | null;
        };
        Returns: undefined;
      };
      assert_permission: {
        Args: {
          p_org: string | null;
          p_permission: string | null;
        };
        Returns: undefined;
      };
      cancel_order: {
        Args: {
          p_order_id: string | null;
          p_reason?: string | null;
        };
        Returns: Json;
      };
      cancel_return: {
        Args: {
          p_return_id: string | null;
          p_reason: string | null;
        };
        Returns: Json;
      };
      cancel_transfer: {
        Args: {
          p_transfer_id: string | null;
          p_reason: string | null;
        };
        Returns: undefined;
      };
      cart_clear: {
        Args: {
          p_organization_id: string | null;
          p_token: string | null;
        };
        Returns: undefined;
      };
      cart_get: {
        Args: {
          p_organization_id: string | null;
          p_token: string | null;
        };
        Returns: Json;
      };
      cart_set_item: {
        Args: {
          p_organization_id: string | null;
          p_token: string | null;
          p_variant_id: string | null;
          p_quantity: number | null;
        };
        Returns: Json;
      };
      checkout: {
        Args: {
          p_organization_id: string | null;
          p_lines: Json | null;
          p_idempotency_key: string | null;
          p_contact: Json | null;
          p_fulfilment: Json | null;
          p_payment_method: Enums["payment_method"] | null;
          p_channel?: Enums["sales_channel"] | null;
          p_note?: string | null;
          p_coupon?: string | null;
        };
        Returns: Json;
      };
      close_purchase_order: {
        Args: {
          p_po_id: string | null;
          p_reason: string | null;
        };
        Returns: undefined;
      };
      confirm_order: {
        Args: {
          p_order_id: string | null;
        };
        Returns: Json;
      };
      create_organization: {
        Args: {
          p_name: string | null;
          p_slug: string | null;
          p_owner_user_id: string | null;
          p_plan?: string | null;
          p_currency_code?: string | null;
          p_location_name?: string | null;
        };
        Returns: string;
      };
      create_return: {
        Args: {
          p_order_id: string | null;
          p_location_id: string | null;
          p_lines: Json | null;
          p_refunds: Json | null;
          p_reason?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: Json;
      };
      dashboard_summary: {
        Args: {
          p_organization_id: string | null;
          p_from: string | null;
          p_to: string | null;
        };
        Returns: Json;
      };
      dispatch_transfer: {
        Args: {
          p_transfer_id: string | null;
        };
        Returns: undefined;
      };
      ensure_customer_profile: {
        Args: {
          p_organization_id: string | null;
          p_full_name?: string | null;
          p_phone?: string | null;
        };
        Returns: string;
      };
      expire_reservations: {
        Args: Record<string, never>;
        Returns: number;
      };
      get_order_by_token: {
        Args: {
          p_order_id: string | null;
          p_token: string | null;
        };
        Returns: Json;
      };
      gift_card_lookup: {
        Args: {
          p_organization_id: string | null;
          p_code: string | null;
        };
        Returns: Json;
      };
      has_location_access: {
        Args: {
          p_org: string | null;
          p_location: string | null;
        };
        Returns: boolean;
      };
      has_permission: {
        Args: {
          p_org: string | null;
          p_permission: string | null;
        };
        Returns: boolean;
      };
      inspect_return_line: {
        Args: {
          p_return_line_id: string | null;
          p_disposition: Enums["return_disposition"] | null;
          p_note?: string | null;
        };
        Returns: Json;
      };
      inventory_integrity_report: {
        Args: {
          p_organization_id: string | null;
        };
        Returns: { check_name: string | null; location_id: string | null; variant_id: string | null; expected: number | null; actual: number | null }[];
      };
      is_member: {
        Args: {
          p_org: string | null;
        };
        Returns: boolean;
      };
      is_platform_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      issue_gift_card: {
        Args: {
          p_organization_id: string | null;
          p_amount: number | null;
          p_reason: string | null;
          p_customer_id?: string | null;
        };
        Returns: Json;
      };
      list_staff: {
        Args: {
          p_organization_id: string | null;
        };
        Returns: { user_id: string | null; email: string | null; role: Enums["staff_role"] | null; location_ids: string[] | null; is_active: boolean | null; has_pin: boolean | null; created_at: string | null }[];
      };
      lookup_serial: {
        Args: {
          p_organization_id: string | null;
          p_serial: string | null;
        };
        Returns: Json;
      };
      module_enabled: {
        Args: {
          p_org: string | null;
          p_module: Enums["module_key"] | null;
        };
        Returns: boolean;
      };
      my_account: {
        Args: {
          p_organization_id: string | null;
        };
        Returns: Json;
      };
      my_workspaces: {
        Args: Record<string, never>;
        Returns: { organization_id: string | null; name: string | null; slug: string | null; currency_code: string | null; timezone: string | null; prices_include_tax: boolean | null; settings: Json | null; role: Enums["staff_role"] | null; permissions: string[] | null; location_ids: string[] | null; modules: Enums["module_key"][] | null }[];
      };
      next_document_number: {
        Args: {
          p_org: string | null;
          p_doc_type: string | null;
          p_prefix: string | null;
          p_scope?: string | null;
        };
        Returns: string;
      };
      open_warranty_claim: {
        Args: {
          p_organization_id: string | null;
          p_order_line_id: string | null;
          p_issue: string | null;
          p_serial?: string | null;
        };
        Returns: Json;
      };
      owns_order: {
        Args: {
          p_order: string | null;
        };
        Returns: boolean;
      };
      place_order: {
        Args: {
          p_location_id: string | null;
          p_channel: Enums["sales_channel"] | null;
          p_lines: Json | null;
          p_customer_id?: string | null;
          p_idempotency_key?: string | null;
          p_note?: string | null;
          p_payments?: Json | null;
          p_order_discount?: Json | null;
          p_approval_id?: string | null;
        };
        Returns: Json;
      };
      place_purchase_order: {
        Args: {
          p_po_id: string | null;
        };
        Returns: undefined;
      };
      pos_approvers: {
        Args: {
          p_organization_id: string | null;
        };
        Returns: { user_id: string | null; email: string | null; role: Enums["staff_role"] | null; discount_limit: number | null }[];
      };
      pos_cash_movement: {
        Args: {
          p_shift_id: string | null;
          p_kind: Enums["cash_movement_kind"] | null;
          p_amount: number | null;
          p_reason: string | null;
        };
        Returns: Json;
      };
      pos_close_shift: {
        Args: {
          p_shift_id: string | null;
          p_counted_cash: number | null;
          p_note?: string | null;
        };
        Returns: Json;
      };
      pos_context: {
        Args: {
          p_organization_id: string | null;
        };
        Returns: Json;
      };
      pos_exchange: {
        Args: {
          p_shift_id: string | null;
          p_order_id: string | null;
          p_return_lines: Json | null;
          p_new_lines: Json | null;
          p_payments: Json | null;
          p_idempotency_key: string | null;
          p_leftover_method?: Enums["payment_method"] | null;
          p_customer_id?: string | null;
          p_reason?: string | null;
        };
        Returns: Json;
      };
      pos_hold_sale: {
        Args: {
          p_shift_id: string | null;
          p_lines: Json | null;
          p_customer_id?: string | null;
          p_label?: string | null;
        };
        Returns: string;
      };
      pos_open_shift: {
        Args: {
          p_terminal_id: string | null;
          p_opening_float: number | null;
        };
        Returns: Json;
      };
      pos_quote: {
        Args: {
          p_shift_id: string | null;
          p_lines: Json | null;
          p_order_discount?: Json | null;
          p_coupon?: string | null;
        };
        Returns: Json;
      };
      pos_receipt: {
        Args: {
          p_order_id: string | null;
        };
        Returns: Json;
      };
      pos_resume_sale: {
        Args: {
          p_shift_id: string | null;
          p_held_id: string | null;
        };
        Returns: Json;
      };
      pos_return: {
        Args: {
          p_shift_id: string | null;
          p_order_id: string | null;
          p_lines: Json | null;
          p_refunds: Json | null;
          p_idempotency_key: string | null;
          p_reason?: string | null;
        };
        Returns: Json;
      };
      pos_sale: {
        Args: {
          p_shift_id: string | null;
          p_lines: Json | null;
          p_payments: Json | null;
          p_idempotency_key: string | null;
          p_customer_id?: string | null;
          p_order_discount?: Json | null;
          p_approval_id?: string | null;
          p_note?: string | null;
          p_coupon?: string | null;
        };
        Returns: Json;
      };
      pos_shift_summary: {
        Args: {
          p_shift_id: string | null;
        };
        Returns: Json;
      };
      pos_take_payment: {
        Args: {
          p_shift_id: string | null;
          p_order_id: string | null;
          p_method: Enums["payment_method"] | null;
          p_amount: number | null;
          p_reference?: string | null;
        };
        Returns: Json;
      };
      preview_return: {
        Args: {
          p_order_id: string | null;
          p_lines?: Json | null;
        };
        Returns: Json;
      };
      quote_order: {
        Args: {
          p_organization_id: string | null;
          p_lines: Json | null;
          p_fulfilment_method?: Enums["fulfilment_method"] | null;
          p_coupon?: string | null;
          p_channel?: Enums["sales_channel"] | null;
        };
        Returns: Json;
      };
      receive_purchase_order: {
        Args: {
          p_po_id: string | null;
          p_lines: Json | null;
          p_reference?: string | null;
          p_note?: string | null;
        };
        Returns: Json;
      };
      receive_return: {
        Args: {
          p_return_id: string | null;
          p_location_id: string | null;
          p_refunds: Json | null;
        };
        Returns: Json;
      };
      receive_stock: {
        Args: {
          p_location_id: string | null;
          p_lines: Json | null;
          p_reference?: string | null;
          p_note?: string | null;
        };
        Returns: Json;
      };
      receive_transfer: {
        Args: {
          p_transfer_id: string | null;
          p_lines?: Json | null;
          p_note?: string | null;
        };
        Returns: undefined;
      };
      record_gateway_payment: {
        Args: {
          p_order_id: string | null;
          p_provider: string | null;
          p_reference: string | null;
          p_amount: number | null;
          p_status?: Enums["payment_status"] | null;
          p_payload?: Json | null;
        };
        Returns: Json;
      };
      record_payment: {
        Args: {
          p_order_id: string | null;
          p_method: Enums["payment_method"] | null;
          p_amount: number | null;
          p_reference?: string | null;
          p_note?: string | null;
        };
        Returns: Json;
      };
      refund_payment: {
        Args: {
          p_order_id: string | null;
          p_amount: number | null;
          p_method: Enums["payment_method"] | null;
          p_reason: string | null;
          p_reference?: string | null;
        };
        Returns: Json;
      };
      reorder_suggestions: {
        Args: {
          p_organization_id: string | null;
          p_location_id?: string | null;
        };
        Returns: { variant_id: string | null; product_name: string | null; variant_title: string | null; sku: string | null; location_id: string | null; location_name: string | null; available: number | null; low_stock_level: number | null; on_order: number | null; suggested: number | null; last_supplier_id: string | null; last_supplier: string | null; last_cost: number | null }[];
      };
      report_customers: {
        Args: {
          p_organization_id: string | null;
          p_from: string | null;
          p_to: string | null;
          p_location_id?: string | null;
          p_channel?: Enums["sales_channel"] | null;
          p_limit?: number | null;
        };
        Returns: Json;
      };
      report_inventory: {
        Args: {
          p_organization_id: string | null;
          p_location_id?: string | null;
          p_days?: number | null;
        };
        Returns: Json;
      };
      report_products: {
        Args: {
          p_organization_id: string | null;
          p_from: string | null;
          p_to: string | null;
          p_location_id?: string | null;
          p_channel?: Enums["sales_channel"] | null;
          p_group?: string | null;
          p_limit?: number | null;
        };
        Returns: Json;
      };
      report_promotions: {
        Args: {
          p_organization_id: string | null;
          p_from: string | null;
          p_to: string | null;
          p_location_id?: string | null;
          p_channel?: Enums["sales_channel"] | null;
        };
        Returns: Json;
      };
      report_sales: {
        Args: {
          p_organization_id: string | null;
          p_from: string | null;
          p_to: string | null;
          p_location_id?: string | null;
          p_channel?: Enums["sales_channel"] | null;
          p_interval?: string | null;
        };
        Returns: Json;
      };
      report_staff: {
        Args: {
          p_organization_id: string | null;
          p_from: string | null;
          p_to: string | null;
          p_location_id?: string | null;
          p_channel?: Enums["sales_channel"] | null;
        };
        Returns: Json;
      };
      request_override: {
        Args: {
          p_organization_id: string | null;
          p_approver_id: string | null;
          p_pin: string | null;
          p_purpose?: string | null;
        };
        Returns: Json;
      };
      request_return: {
        Args: {
          p_order_id: string | null;
          p_token: string | null;
          p_lines: Json | null;
          p_reason: string | null;
        };
        Returns: Json;
      };
      request_transfer: {
        Args: {
          p_from: string | null;
          p_to: string | null;
          p_lines: Json | null;
          p_note?: string | null;
        };
        Returns: string;
      };
      role_permissions: {
        Args: {
          p_role: Enums["staff_role"] | null;
        };
        Returns: string[];
      };
      save_product: {
        Args: {
          p_organization_id: string | null;
          p_product: Json | null;
        };
        Returns: string;
      };
      save_promotion: {
        Args: {
          p_organization_id: string | null;
          p_promo: Json | null;
        };
        Returns: string;
      };
      save_purchase_order: {
        Args: {
          p_organization_id: string | null;
          p_po: Json | null;
        };
        Returns: string;
      };
      search_variants: {
        Args: {
          p_organization_id: string | null;
          p_query: string | null;
          p_location_id?: string | null;
          p_limit?: number | null;
        };
        Returns: { variant_id: string | null; product_id: string | null; product_name: string | null; variant_title: string | null; sku: string | null; barcode: string | null; price: number | null; status: Enums["product_status"] | null; tracking_mode: Enums["tracking_mode"] | null; unit_of_measure: string | null; allow_fractional: boolean | null; on_hand: number | null; available: number | null }[];
      };
      set_low_stock_threshold: {
        Args: {
          p_location_id: string | null;
          p_variant_id: string | null;
          p_threshold: number | null;
        };
        Returns: undefined;
      };
      set_my_pin: {
        Args: {
          p_organization_id: string | null;
          p_pin: string | null;
        };
        Returns: undefined;
      };
      set_organization_module: {
        Args: {
          p_organization_id: string | null;
          p_module: Enums["module_key"] | null;
          p_enabled: boolean | null;
        };
        Returns: undefined;
      };
      set_product_warranty: {
        Args: {
          p_product_id: string | null;
          p_months: number | null;
          p_terms?: string | null;
        };
        Returns: undefined;
      };
      slugify: {
        Args: {
          p_text: string | null;
        };
        Returns: string;
      };
      start_checkout: {
        Args: {
          p_organization_id: string | null;
          p_lines: Json | null;
          p_idempotency_key: string | null;
          p_channel?: Enums["sales_channel"] | null;
          p_customer_id?: string | null;
          p_note?: string | null;
        };
        Returns: Json;
      };
      stock_movements: {
        Args: {
          p_organization_id: string | null;
          p_variant_id: string | null;
          p_location_id?: string | null;
          p_limit?: number | null;
        };
        Returns: { id: number | null; created_at: string | null; location_name: string | null; movement_type: Enums["movement_type"] | null; quantity: number | null; unit_cost: number | null; lot_code: string | null; serial: string | null; source_type: string | null; source_id: string | null; reference: string | null; note: string | null; actor_email: string | null }[];
      };
      stock_overview: {
        Args: {
          p_organization_id: string | null;
          p_location_id?: string | null;
          p_query?: string | null;
          p_low_only?: boolean | null;
          p_limit?: number | null;
          p_offset?: number | null;
        };
        Returns: { variant_id: string | null; product_id: string | null; product_name: string | null; variant_title: string | null; sku: string | null; tracking_mode: Enums["tracking_mode"] | null; unit_of_measure: string | null; location_id: string | null; location_name: string | null; on_hand: number | null; reserved: number | null; available: number | null; low_stock_threshold: number | null; is_low: boolean | null; avg_unit_cost: number | null; stock_value: number | null }[];
      };
      storefront_availability: {
        Args: {
          p_organization_id: string | null;
          p_variant_ids?: string[] | null;
        };
        Returns: { variant_id: string | null; available: number | null }[];
      };
      storefront_catalog: {
        Args: {
          p_organization_id: string | null;
          p_category_slug?: string | null;
          p_query?: string | null;
          p_filters?: Json | null;
          p_sort?: string | null;
          p_limit?: number | null;
          p_offset?: number | null;
        };
        Returns: Json;
      };
      storefront_categories: {
        Args: {
          p_organization_id: string | null;
        };
        Returns: { id: string | null; parent_id: string | null; name: string | null; slug: string | null; sort_order: number | null; product_count: number | null }[];
      };
      storefront_organization: {
        Args: {
          p_slug: string | null;
        };
        Returns: { id: string | null; name: string | null; slug: string | null; currency_code: string | null; timezone: string | null }[];
      };
      storefront_product: {
        Args: {
          p_organization_id: string | null;
          p_slug: string | null;
        };
        Returns: Json;
      };
      storefront_settings: {
        Args: {
          p_organization_id: string | null;
        };
        Returns: Json;
      };
      update_organization_settings: {
        Args: {
          p_organization_id: string | null;
          p_changes: Json | null;
        };
        Returns: Json;
      };
      update_warranty_claim: {
        Args: {
          p_claim_id: string | null;
          p_status: Enums["warranty_claim_status"] | null;
          p_note?: string | null;
          p_resolution?: string | null;
        };
        Returns: Json;
      };
      upsert_staff_member: {
        Args: {
          p_organization_id: string | null;
          p_user_id: string | null;
          p_role: Enums["staff_role"] | null;
          p_location_ids?: string[] | null;
          p_is_active?: boolean | null;
        };
        Returns: undefined;
      };
      void_gift_card: {
        Args: {
          p_organization_id: string | null;
          p_code: string | null;
          p_reason: string | null;
        };
        Returns: undefined;
      };
      warranty_claim: {
        Args: {
          p_claim_id: string | null;
        };
        Returns: Json;
      };
      warranty_lookup: {
        Args: {
          p_organization_id: string | null;
          p_query: string | null;
        };
        Returns: Json;
      };
    };
    Enums: {
      attribute_type: "text" | "number" | "boolean" | "option";
      cash_movement_kind: "paid_in" | "paid_out" | "drop";
      fulfilment_method: "in_store" | "pickup" | "delivery";
      location_kind: "store" | "warehouse";
      module_key: "storefront" | "pos" | "multi_location" | "purchasing" | "transfers" | "returns" | "promotions" | "loyalty" | "wholesale" | "reviews" | "mobile_app" | "serial_tracking" | "batch_tracking" | "warranty";
      movement_type: "receipt" | "sale" | "sale_return" | "adjustment_in" | "adjustment_out" | "damage" | "transfer_out" | "transfer_in";
      order_status: "pending_payment" | "confirmed" | "completed" | "cancelled" | "expired" | "stock_conflict";
      payment_kind: "payment" | "refund";
      payment_method: "cash" | "card" | "bank_transfer" | "qr" | "online_gateway" | "store_credit" | "cash_on_delivery" | "return_credit" | "gift_card" | "loyalty_points";
      payment_state: "unpaid" | "partially_paid" | "paid" | "partially_refunded" | "refunded";
      payment_status: "pending" | "captured" | "failed" | "voided";
      po_status: "draft" | "ordered" | "partially_received" | "received" | "closed" | "cancelled";
      product_status: "draft" | "active" | "archived";
      promotion_kind: "percent_off" | "amount_off" | "buy_x_get_y";
      promotion_scope: "products" | "order";
      reservation_status: "active" | "consumed" | "released" | "expired";
      return_disposition: "pending_inspection" | "restock" | "damaged" | "service" | "write_off";
      return_status: "requested" | "received" | "cancelled";
      sales_channel: "online" | "pos" | "mobile_app" | "phone_order" | "admin_order";
      serial_status: "available" | "reserved" | "sold" | "in_transit" | "inspection" | "damaged" | "written_off" | "returned_to_supplier";
      shift_status: "open" | "closed";
      staff_role: "owner" | "admin" | "manager" | "cashier" | "stock_keeper" | "viewer";
      tracking_mode: "none" | "serial" | "batch" | "non_stock";
      transfer_status: "requested" | "approved" | "dispatched" | "received" | "cancelled";
      warranty_claim_status: "open" | "received" | "in_repair" | "awaiting_parts" | "ready" | "replaced" | "refunded" | "rejected" | "closed";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

export type Enums = Database["public"]["Enums"];
export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
export type Views<T extends keyof Database["public"]["Views"]> = Database["public"]["Views"][T]["Row"];
