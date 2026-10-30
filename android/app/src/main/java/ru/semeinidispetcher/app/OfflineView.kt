package ru.semeinidispetcher.app

import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Экран без интернета: понятное сообщение и дела на момент последнего обновления
 * (снимок присылает веб-часть), а не ошибка браузера.
 */
class OfflineView(context: Context, snapshot: String?, onRetry: () -> Unit) : ScrollView(context) {
    init {
        setBackgroundColor(ContextCompat.getColor(context, R.color.background))
        isFillViewport = true
        val column = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(32), dp(20), dp(32))
        }
        addView(column)

        column.addView(text(R.string.offline_title, 26f, bold = true))
        column.addView(text(R.string.offline_text, 16f, color = R.color.ink2).apply { setPadding(0, dp(8), 0, dp(16)) })
        column.addView(
            Button(context).apply {
                setText(R.string.offline_retry)
                setOnClickListener { onRetry() }
            },
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT),
        )

        val tasks = parse(snapshot)
        column.addView(text(R.string.offline_cached, 13f, bold = true, color = R.color.ink2).apply {
            isAllCaps = true
            setPadding(0, dp(28), 0, dp(10))
        })
        if (tasks.isEmpty()) {
            column.addView(text(R.string.offline_empty, 15f, color = R.color.ink2))
        }
        for ((title, details) in tasks) {
            column.addView(card(title, details))
        }
    }

    private fun parse(snapshot: String?): List<Pair<String, String>> = try {
        val items = JSONObject(snapshot ?: "{}").optJSONArray("tasks")
        (0 until (items?.length() ?: 0)).mapNotNull { i ->
            val item = items!!.optJSONObject(i) ?: return@mapNotNull null
            val title = item.optString("title")
            if (title.isEmpty()) null else title to item.optString("details")
        }
    } catch (_: Exception) {
        emptyList()
    }

    private fun card(title: String, details: String): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(16), dp(12), dp(16), dp(12))
        background = GradientDrawable().apply {
            cornerRadius = dp(16).toFloat()
            setColor(ContextCompat.getColor(context, R.color.card))
        }
        addView(TextView(context).apply {
            this.text = title
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            setTextColor(ContextCompat.getColor(context, R.color.ink))
        })
        if (details.isNotEmpty()) addView(TextView(context).apply {
            this.text = details
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTextColor(ContextCompat.getColor(context, R.color.ink2))
        })
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply { bottomMargin = dp(8) }
    }

    private fun text(res: Int, size: Float, bold: Boolean = false, color: Int = R.color.ink) =
        TextView(context).apply {
            setText(res)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
            setTextColor(ContextCompat.getColor(context, color))
            gravity = Gravity.START
            if (bold) typeface = Typeface.DEFAULT_BOLD
        }

    private fun dp(value: Int) = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics,
    ).toInt()
}
